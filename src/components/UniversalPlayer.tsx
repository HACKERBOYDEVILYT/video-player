import React, { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  RotateCcw,
  RotateCw,
  PictureInPicture2,
  Repeat,
  Camera,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
  Sliders,
  Download,
  ListPlus,
  Subtitles,
  StepBack,
  StepForward,
  Smartphone,
  Heart,
  Sun,
} from 'lucide-react';
import { VideoItem } from '../types';

interface UniversalPlayerProps {
  video: VideoItem;
  initialTimeSec?: number;
  defaultSpeed?: number;
  theaterMode: boolean;
  onToggleTheater: () => void;
  onTimeUpdateRecord: (currentTime: number, duration: number) => void;
  onVideoEnded: () => void;
  onTriggerDownload: (video: VideoItem) => void;
  onAddToPlaylist: (video: VideoItem) => void;
  onToggleFavorite?: (video: VideoItem) => void;
  isFavorite?: boolean;
}

interface HlsQualityLevel {
  index: number;
  height: number;
  bitrateKbps: number;
  label: string;
}

interface HlsAudioTrackItem {
  id: number;
  name: string;
  lang: string;
}

export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Convert .srt subtitle content to WebVTT (.vtt)
function convertSrtToVtt(srtText: string): string {
  const normalized = srtText
    .replace(/\r\n/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  if (normalized.trim().startsWith('WEBVTT')) return normalized;
  return `WEBVTT\n\n${normalized}`;
}

const DEFAULT_SAMPLE_VTT = `WEBVTT

00:00:00.500 --> 00:00:06.000
NOIR Video Studio — Universal Cinema Engine (MP4 / WebM / HLS)

00:00:06.500 --> 00:00:14.000
ডাবল-ট্যাপ করে ১০ সেকেন্ড স্কিপ করুন, অথবা A-B Repeat ও ফ্রেম-বাই-ফ্রেম কন্ট্রোল ব্যবহার করুন।

00:00:14.500 --> 00:00:25.000
Adaptive Bitrate Streaming এবং কাস্টম .SRT / .VTT সাবটাইটেল সক্রিয় রয়েছে।
`;

export const UniversalPlayer: React.FC<UniversalPlayerProps> = ({
  video,
  initialTimeSec = 0,
  defaultSpeed = 1,
  theaterMode,
  onToggleTheater,
  onTimeUpdateRecord,
  onVideoEnded,
  onTriggerDownload,
  onAddToPlaylist,
  onToggleFavorite,
  isFavorite = false,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const subtitleInputRef = useRef<HTMLInputElement | null>(null);
  const lastRecordTimeRef = useRef<number>(0);
  const lastTapRef = useRef<{ time: number; side: 'left' | 'right' }>({ time: 0, side: 'left' });
  const touchStartRef = useRef<{ x: number; y: number; side: 'left' | 'right' } | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(0.9);
  const [isMuted, setIsMuted] = useState(false);
  const [brightness, setBrightness] = useState(100); // 50% to 150%
  const [playbackRate, setPlaybackRate] = useState(defaultSpeed);
  const [isLooping, setIsLooping] = useState(false);
  const [abLoop, setAbLoop] = useState<{ a: number | null; b: number | null }>({ a: null, b: null });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [useBackendProxy, setUseBackendProxy] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [qualityLevels, setQualityLevels] = useState<HlsQualityLevel[]>([]);
  const [selectedLevel, setSelectedLevel] = useState<number>(-1);
  const [audioTracks, setAudioTracks] = useState<HlsAudioTrackItem[]>([]);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState<number>(0);
  const [activeResolution, setActiveResolution] = useState<string>(video.resolution);
  const [isHdrSupported, setIsHdrSupported] = useState<boolean>(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(false);
  const [customVttUrl, setCustomVttUrl] = useState<string>(() => {
    const blob = new Blob([DEFAULT_SAMPLE_VTT], { type: 'text/vtt' });
    return URL.createObjectURL(blob);
  });
  const [subtitleLabel, setSubtitleLabel] = useState<string>('Studio Default (BN/EN)');
  const [hudNotice, setHudNotice] = useState<string | null>(null);

  const showHud = useCallback((msg: string) => {
    setHudNotice(msg);
    setTimeout(() => {
      setHudNotice((prev) => (prev === msg ? null : prev));
    }, 2200);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      setIsHdrSupported(window.matchMedia('(dynamic-range: high)').matches);
    }
  }, []);

  // Buffering watchdog: auto-clear stuck buffering after 3.5s
  useEffect(() => {
    if (!isBuffering) return;
    const timer = setTimeout(() => {
      setIsBuffering(false);
    }, 3500);
    return () => clearTimeout(timer);
  }, [isBuffering]);

  const effectiveStreamUrl = useCallback(() => {
    if (video.url.startsWith('blob:') || video.url.startsWith('/api/')) return video.url;
    if (useBackendProxy && video.format !== 'HLS') {
      return `/api/video/stream?url=${encodeURIComponent(video.url)}`;
    }
    return video.url;
  }, [video.url, video.format, useBackendProxy]);

  useEffect(() => {
    setUseBackendProxy(false);
    setPlayerError(null);
    setCurrentTime(0);
    setDuration(0);
    setBufferedEnd(0);
    setQualityLevels([]);
    setSelectedLevel(-1);
    setAudioTracks([]);
    setSelectedAudioTrack(0);
    setAbLoop({ a: null, b: null });
    setActiveResolution(video.resolution);
  }, [video.id, video.url, video.resolution]);

  // Initialize HTML5 Video or HLS.js
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    setPlayerError(null);
    setIsBuffering(false);
    setIsPlaying(false);

    const streamUrl = effectiveStreamUrl();
    const isHlsStream =
      video.format === 'HLS' || streamUrl.toLowerCase().includes('.m3u8');

    if (isHlsStream) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
        });
        hlsRef.current = hls;
        hls.loadSource(streamUrl);
        hls.attachMedia(vid);

        hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
          setIsBuffering(false);
          const levels: HlsQualityLevel[] = data.levels.map((lvl, idx) => ({
            index: idx,
            height: lvl.height || 0,
            bitrateKbps: Math.round((lvl.bitrate || 0) / 1000),
            label: lvl.height
              ? `${lvl.height}p (${Math.round((lvl.bitrate || 0) / 1000)} kbps)`
              : `Level ${idx + 1}`,
          }));
          setQualityLevels(levels);
          vid.playbackRate = playbackRate;
          if (initialTimeSec > 2) {
            vid.currentTime = initialTimeSec;
            showHud(`রিজিউম করা হয়েছে: ${formatTimecode(initialTimeSec)}`);
          }
        });

        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_event, data) => {
          const tracks: HlsAudioTrackItem[] = data.audioTracks.map((t, i) => ({
            id: i,
            name: t.name || `Track ${i + 1}`,
            lang: t.lang || 'default',
          }));
          setAudioTracks(tracks);
        });

        hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
          const levelObj = hls.levels[data.level];
          if (levelObj && levelObj.height) {
            const is4k = levelObj.height >= 2160;
            setActiveResolution(`${levelObj.height}p ${is4k ? '4K ' : ''}HLS`);
          }
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                setPlayerError(
                  'HLS নেটওয়ার্ক সংযোগ বিচ্ছিন্ন হয়েছে বা স্ট্রিম URL অনুপলব্ধ (CORS / Network Error)।'
                );
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                setPlayerError(
                  'HLS স্ট্রিম ডিকোড করা সম্ভব হয়নি অথবা স্ট্রিমটি এনক্রিপ্টেড (DRM)।'
                );
                hls.destroy();
                break;
            }
            setIsBuffering(false);
          }
        });
      } else if (vid.canPlayType('application/vnd.apple.mpegurl')) {
        vid.src = streamUrl;
        vid.playbackRate = playbackRate;
        if (initialTimeSec > 2) {
          vid.currentTime = initialTimeSec;
        }
      } else {
        setPlayerError('আপনার ব্রাউজারে HLS/M3U8 প্লেব্যাক সমর্থিত নয়।');
        setIsBuffering(false);
      }
    } else {
      vid.src = streamUrl;
      vid.load();
      vid.playbackRate = playbackRate;
      if (initialTimeSec > 2) {
        vid.currentTime = initialTimeSec;
        showHud(`রিজিউম করা হয়েছে: ${formatTimecode(initialTimeSec)}`);
      }
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [effectiveStreamUrl, video.format, initialTimeSec]);

  // Manage subtitle track mode
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !vid.textTracks || vid.textTracks.length === 0) return;
    for (let i = 0; i < vid.textTracks.length; i++) {
      vid.textTracks[i].mode = subtitlesEnabled ? 'showing' : 'hidden';
    }
  }, [subtitlesEnabled, customVttUrl]);

  const togglePlay = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused || vid.ended) {
      vid.play().catch(() => {
        setPlayerError(
          'স্ট্রিম প্লেব্যাক বাধাপ্রাপ্ত হয়েছে। Play বাটনে ক্লিক করুন অথবা Proxy মোড ব্যবহার করুন।'
        );
      });
    } else {
      vid.pause();
    }
  }, []);

  const skipSeconds = useCallback(
    (delta: number) => {
      const vid = videoRef.current;
      if (!vid) return;
      const next = Math.max(0, Math.min(vid.duration || 0, vid.currentTime + delta));
      vid.currentTime = next;
      setCurrentTime(next);
      showHud(`${delta > 0 ? '+' : ''}${delta}s (${formatTimecode(next)})`);
    },
    [showHud]
  );

  // Frame-by-frame step (1/30th second)
  const stepFrame = useCallback(
    (direction: -1 | 1) => {
      const vid = videoRef.current;
      if (!vid) return;
      vid.pause();
      const frameDuration = 1 / 30;
      const next = Math.max(0, Math.min(vid.duration || 0, vid.currentTime + direction * frameDuration));
      vid.currentTime = next;
      setCurrentTime(next);
      showHud(`Frame ${direction > 0 ? '+1' : '-1'} (${next.toFixed(2)}s)`);
    },
    [showHud]
  );

  // Handle A-B Repeat Loop
  const handleToggleAbPoint = () => {
    if (abLoop.a === null) {
      setAbLoop({ a: currentTime, b: null });
      showHud(`A-B Loop: Point A সেট হয়েছে (${formatTimecode(currentTime)})`);
    } else if (abLoop.b === null) {
      if (currentTime <= abLoop.a + 0.5) {
        showHud('Point B অবশ্যই Point A-এর পরে হতে হবে');
        return;
      }
      setAbLoop({ a: abLoop.a, b: currentTime });
      showHud(
        `A-B Loop সক্রিয়: ${formatTimecode(abLoop.a)} → ${formatTimecode(currentTime)}`
      );
    } else {
      setAbLoop({ a: null, b: null });
      showHud('A-B Repeat Loop বন্ধ করা হয়েছে');
    }
  };

  // Double-tap left/right side of video to seek -10s / +10s
  const handleVideoSurfaceClick = (e: React.MouseEvent<HTMLVideoElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const side: 'left' | 'right' = clickX < rect.width / 2 ? 'left' : 'right';
    const now = Date.now();

    if (now - lastTapRef.current.time < 300 && lastTapRef.current.side === side) {
      skipSeconds(side === 'left' ? -10 : 10);
      lastTapRef.current = { time: 0, side };
    } else {
      lastTapRef.current = { time: now, side };
      togglePlay();
    }
  };

  // Mobile Touch Gesture for Brightness (left side) and Volume (right side)
  const handleTouchStart = (e: React.TouchEvent<HTMLVideoElement>) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    const side: 'left' | 'right' = touch.clientX - rect.left < rect.width / 2 ? 'left' : 'right';
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, side };
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLVideoElement>) => {
    if (!touchStartRef.current || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const deltaY = touchStartRef.current.y - touch.clientY;
    if (Math.abs(deltaY) < 24) return;

    if (touchStartRef.current.side === 'left') {
      const nextBright = Math.max(50, Math.min(150, brightness + (deltaY > 0 ? 5 : -5)));
      setBrightness(nextBright);
      showHud(`উজ্জ্বলতা (Brightness): ${nextBright}%`);
    } else {
      const vid = videoRef.current;
      if (vid) {
        const nextVol = Math.max(0, Math.min(1, Number((volume + (deltaY > 0 ? 0.05 : -0.05)).toFixed(2))));
        vid.volume = nextVol;
        vid.muted = nextVol === 0;
        setVolume(nextVol);
        setIsMuted(nextVol === 0);
        showHud(`ভলিউম (Volume): ${Math.round(nextVol * 100)}%`);
      }
    }
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, side: touchStartRef.current.side };
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vid = videoRef.current;
    if (!vid) return;
    const nextTime = parseFloat(e.target.value);
    vid.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vid = videoRef.current;
    if (!vid) return;
    const nextVol = parseFloat(e.target.value);
    vid.volume = nextVol;
    vid.muted = nextVol === 0;
    setVolume(nextVol);
    setIsMuted(nextVol === 0);
  };

  const toggleMute = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    const nextMuted = !vid.muted;
    vid.muted = nextMuted;
    setIsMuted(nextMuted);
  }, []);

  const changeSpeed = (rate: number) => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.playbackRate = rate;
    setPlaybackRate(rate);
    showHud(`প্লেব্যাক স্পিড: ${rate}x`);
  };

  const changeHlsLevel = (levelIndex: number) => {
    setSelectedLevel(levelIndex);
    if (hlsRef.current) {
      hlsRef.current.currentLevel = levelIndex;
      showHud(levelIndex === -1 ? 'HLS কোয়ালিটি: Auto' : `HLS কোয়ালিটি পরিবর্তিত হয়েছে`);
    }
  };

  const changeHlsAudioTrack = (trackId: number) => {
    setSelectedAudioTrack(trackId);
    if (hlsRef.current) {
      hlsRef.current.audioTrack = trackId;
      showHud('অডিও ট্র্যাক পরিবর্তিত হয়েছে');
    }
  };

  const handleSubtitleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const rawText = await file.text();
    const vttText = convertSrtToVtt(rawText);
    const blob = new Blob([vttText], { type: 'text/vtt' });
    const url = URL.createObjectURL(blob);
    setCustomVttUrl(url);
    setSubtitleLabel(file.name);
    setSubtitlesEnabled(true);
    showHud(`সাবটাইটেল লোড হয়েছে: ${file.name}`);
  };

  const handleOrientationLock = async () => {
    try {
      const scr = window.screen?.orientation as ScreenOrientation & {
        lock?: (mode: string) => Promise<void>;
        unlock?: () => void;
      };
      if (scr && typeof scr.lock === 'function') {
        await scr.lock('landscape');
        showHud('স্ক্রিন ওরিয়েন্টেশন ল্যান্ডস্কেপে লক করা হয়েছে');
      } else {
        showHud('এই ডিভাইস/ব্রাউজারে সরাসরি Orientation Lock API সমর্থিত নয় (ফুলস্ক্রিন ব্যবহার করুন)');
      }
    } catch {
      showHud('ওরিয়েন্টেশন লক করতে প্রথমে ফুলস্ক্রিন মোড চালু করুন বা মোবাইল ব্রাউজার ব্যবহার করুন');
    }
  };

  const toggleFullscreen = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;
    try {
      if (!document.fullscreenElement) {
        await container.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      const vid = videoRef.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
      if (vid?.webkitEnterFullscreen) {
        vid.webkitEnterFullscreen();
      }
    }
  }, []);

  const togglePiP = async () => {
    const vid = videoRef.current;
    if (!vid) return;
    try {
      if (!document.pictureInPictureEnabled) {
        showHud('আপনার ব্রাউজারে Picture-in-Picture সমর্থিত নয়');
        return;
      }
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await vid.requestPictureInPicture();
      }
    } catch {
      showHud('Picture-in-Picture চালু করা যায়নি');
    }
  };

  const captureFrameSnapshot = () => {
    const vid = videoRef.current;
    if (!vid || vid.videoWidth === 0) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = vid.videoWidth;
      canvas.height = vid.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `noir-frame-${Math.floor(vid.currentTime)}s.png`;
      a.click();
      showHud('ফ্রেম স্ন্যাপশট সংরক্ষিত হয়েছে');
    } catch {
      showHud('স্ন্যাপশট নেওয়ার জন্য Backend Proxy মোড চালু করুন');
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === ' ' || e.key.toLowerCase() === 'k') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'l') {
        e.preventDefault();
        skipSeconds(10);
      } else if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'j') {
        e.preventDefault();
        skipSeconds(-10);
      } else if (e.key === '.') {
        e.preventDefault();
        stepFrame(1);
      } else if (e.key === ',') {
        e.preventDefault();
        stepFrame(-1);
      } else if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        toggleMute();
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePlay, skipSeconds, stepFrame, toggleMute, toggleFullscreen]);

  const progressPercentage = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const bufferedPercentage = duration > 0 ? Math.min(100, (bufferedEnd / duration) * 100) : 0;

  return (
    <div className="noir-card rounded-2xl overflow-hidden">
      <input
        ref={subtitleInputRef}
        type="file"
        accept=".vtt,.srt,text/vtt,application/x-subrip"
        onChange={handleSubtitleFileUpload}
        className="hidden"
      />

      {/* Video Viewport Container */}
      <div
        ref={containerRef}
        className={`relative bg-[#050508] w-full select-none group ${
          theaterMode ? 'aspect-[21/9] max-h-[74vh]' : 'aspect-video'
        }`}
      >
        <video
          ref={videoRef}
          poster={video.thumbnail}
          preload="metadata"
          playsInline
          loop={isLooping}
          style={{ filter: `brightness(${brightness}%)` }}
          onClick={handleVideoSurfaceClick}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onPlay={() => {
            setIsPlaying(true);
            setIsBuffering(false);
          }}
          onPause={() => setIsPlaying(false)}
          onWaiting={() => setIsBuffering(true)}
          onCanPlay={() => setIsBuffering(false)}
          onLoadedData={() => setIsBuffering(false)}
          onLoadedMetadata={(e) => {
            const vid = e.currentTarget;
            setDuration(vid.duration || 0);
            setIsBuffering(false);
            if (vid.videoWidth && vid.videoHeight && video.format !== 'HLS') {
              const is4k = vid.videoWidth >= 3840 || vid.videoHeight >= 2160;
              setActiveResolution(
                `${vid.videoWidth}x${vid.videoHeight}${is4k ? ' (4K UHD)' : ''}`
              );
            }
          }}
          onTimeUpdate={(e) => {
            const vid = e.currentTarget;
            const t = vid.currentTime;
            setCurrentTime(t);

            // Enforce A-B Repeat Loop if both points are set
            if (abLoop.a !== null && abLoop.b !== null && t >= abLoop.b) {
              vid.currentTime = abLoop.a;
              return;
            }

            if (vid.buffered.length > 0) {
              setBufferedEnd(vid.buffered.end(vid.buffered.length - 1));
            }
            const now = Date.now();
            if (now - lastRecordTimeRef.current > 3000) {
              lastRecordTimeRef.current = now;
              onTimeUpdateRecord(t, vid.duration || 0);
            }
          }}
          onEnded={() => {
            setIsPlaying(false);
            if (!isLooping) {
              onVideoEnded();
            }
          }}
          onError={() => {
            setIsBuffering(false);
            setPlayerError(
              'সরাসরি ভিডিও স্ট্রিম লোড করতে সমস্যা হয়েছে (CORS রেস্ট্রিকশন, অসমর্থিত কোডেক অথবা মেয়াদোত্তীর্ণ লিংক)। নিচের Backend Stream Proxy চালু করে পুনরায় চেষ্টা করুন।'
            );
          }}
          className="w-full h-full object-contain cursor-pointer"
        >
          <track
            kind="subtitles"
            src={customVttUrl}
            srcLang="bn"
            label={subtitleLabel}
            default={subtitlesEnabled}
          />
        </video>

        {/* Top Scrim Overlay with Unboxed Stream Metadata */}
        <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/85 via-black/40 to-transparent p-4 flex items-start justify-between gap-4 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-150">
          <div className="min-w-0">
            <h2 className="text-sm md:text-base font-bold text-white truncate">
              {video.title}
            </h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-300 font-mono tabular-nums">
              <span className="text-rose-400">{video.format}</span>
              <span aria-hidden="true">·</span>
              <span>{activeResolution}</span>
              {isHdrSupported && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-violet-400">HDR Ready</span>
                </>
              )}
              {abLoop.a !== null && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-rose-400">
                    A-B Loop ({formatTimecode(abLoop.a)}
                    {abLoop.b !== null ? `–${formatTimecode(abLoop.b)}` : '...'})
                  </span>
                </>
              )}
              {useBackendProxy && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-emerald-400">Proxy Active</span>
                </>
              )}
            </div>
          </div>

          {hudNotice && (
            <div className="text-xs font-medium text-rose-300 bg-[#13111C]/95 border border-[#262235] px-3 py-1.5 rounded-lg shadow-lg">
              {hudNotice}
            </div>
          )}
        </div>

        {/* Center Play Button & Active Buffering State */}
        {!playerError && !isPlaying && (
          <button
            onClick={togglePlay}
            aria-label="Play Video"
            className="absolute inset-0 m-auto w-16 h-16 rounded-full bg-[#13111C]/90 border border-rose-500/60 text-rose-500 flex items-center justify-center hover:scale-105 transition-transform duration-150 shadow-2xl z-20 cursor-pointer"
          >
            {isBuffering ? (
              <div className="w-6 h-6 rounded-full border-2 border-rose-500 border-t-transparent animate-spin" />
            ) : (
              <Play className="w-7 h-7 fill-current ml-0.5" />
            )}
          </button>
        )}

        {!playerError && isPlaying && isBuffering && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 z-20">
            <div className="w-12 h-12 rounded-full border-2 border-rose-500 border-t-transparent animate-spin" />
          </div>
        )}

        {/* Error Recovery Overlay */}
        {playerError && (
          <div className="absolute inset-0 bg-[#09090E]/95 flex flex-col items-center justify-center p-6 text-center z-20">
            <AlertTriangle className="w-10 h-10 text-rose-500 mb-3" />
            <h3 className="text-base font-bold text-white max-w-md">
              স্ট্রিম প্লেব্যাক ত্রুটি শনাক্ত হয়েছে
            </h3>
            <p className="mt-1.5 text-xs text-zinc-400 max-w-lg leading-relaxed">
              {playerError}
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              {video.format !== 'HLS' && !useBackendProxy && (
                <button
                  onClick={() => {
                    setPlayerError(null);
                    setUseBackendProxy(true);
                  }}
                  className="min-h-[42px] px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-500 transition-colors flex items-center gap-2 whitespace-nowrap"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>Backend Proxy দিয়ে স্ট্রিম করুন</span>
                </button>
              )}
              <button
                onClick={() => {
                  setPlayerError(null);
                  const vid = videoRef.current;
                  if (vid) {
                    vid.load();
                    vid.play().catch(() => undefined);
                  }
                }}
                className="min-h-[42px] px-4 py-2 rounded-lg bg-[#13111C] border border-[#262235] text-zinc-200 text-xs font-medium hover:border-rose-500/50 transition-colors flex items-center gap-2 whitespace-nowrap"
              >
                <RefreshCw className="w-4 h-4" />
                <span>পুনরায় চেষ্টা করুন</span>
              </button>
            </div>
          </div>
        )}

        {/* Settings Popover (Speed 0.25x-2x, HLS Quality, Audio Tracks, Subtitles, Brightness) */}
        {showSettingsMenu && (
          <div className="absolute bottom-20 right-4 z-30 w-72 rounded-xl bg-[#13111C]/95 backdrop-blur-md border border-[#262235] p-4 shadow-2xl text-white">
            <div className="flex items-center justify-between pb-2.5 border-b border-[#262235]">
              <span className="text-xs font-semibold">প্লেয়ার ইঞ্জিন সেটিংস</span>
              <button
                onClick={() => setShowSettingsMenu(false)}
                className="text-xs text-zinc-400 hover:text-white"
              >
                বন্ধ করুন
              </button>
            </div>

            {/* Playback Speed 0.25x to 2x */}
            <div className="mt-3">
              <span className="block text-xs text-zinc-400 mb-1.5">
                প্লেব্যাক স্পিড (0.25x – 2.0x)
              </span>
              <div className="grid grid-cols-4 gap-1.5 font-mono tabular-nums">
                {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (
                  <button
                    key={rate}
                    onClick={() => changeSpeed(rate)}
                    className={`min-h-[32px] rounded-md text-xs font-medium transition-colors ${
                      playbackRate === rate
                        ? 'bg-rose-600 text-white font-semibold'
                        : 'bg-[#09090E] text-zinc-300 hover:text-white border border-[#262235]'
                    }`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
            </div>

            {/* Brightness Slider */}
            <div className="mt-3 pt-2.5 border-t border-[#262235]">
              <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                <span className="flex items-center gap-1.5">
                  <Sun className="w-3.5 h-3.5 text-rose-400" />
                  <span>ভিডিও উজ্জ্বলতা (Brightness)</span>
                </span>
                <span className="font-mono tabular-nums text-zinc-200">{brightness}%</span>
              </div>
              <input
                type="range"
                min={50}
                max={150}
                step={5}
                value={brightness}
                onChange={(e) => setBrightness(Number(e.target.value))}
                className="noir-slider w-full"
              />
            </div>

            {/* Subtitle Upload & Toggle */}
            <div className="mt-3 pt-2.5 border-t border-[#262235] flex items-center justify-between gap-2">
              <button
                onClick={() => setSubtitlesEnabled(!subtitlesEnabled)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                  subtitlesEnabled
                    ? 'bg-rose-600/20 border-rose-500 text-rose-300'
                    : 'bg-[#09090E] border-[#262235] text-zinc-300'
                }`}
              >
                Subtitles: {subtitlesEnabled ? 'ON' : 'OFF'}
              </button>
              <button
                onClick={() => subtitleInputRef.current?.click()}
                className="px-2.5 py-1.5 rounded-md bg-[#09090E] border border-[#262235] text-xs text-zinc-200 hover:border-rose-500/50 transition-colors"
              >
                + Import .SRT/.VTT
              </button>
            </div>

            {/* HLS Quality Selector */}
            {qualityLevels.length > 0 && (
              <div className="mt-3 pt-2.5 border-t border-[#262235]">
                <span className="block text-xs text-zinc-400 mb-1.5">
                  HLS কোয়ালিটি ও বিটরেট (M3U8)
                </span>
                <div className="space-y-1 max-h-28 overflow-y-auto font-mono tabular-nums">
                  <button
                    onClick={() => changeHlsLevel(-1)}
                    className={`w-full text-left px-2.5 py-1 rounded-md text-xs transition-colors ${
                      selectedLevel === -1
                        ? 'bg-rose-600 text-white font-semibold'
                        : 'text-zinc-300 hover:bg-[#09090E]'
                    }`}
                  >
                    Auto (Adaptive Bitrate)
                  </button>
                  {qualityLevels.map((lvl) => (
                    <button
                      key={lvl.index}
                      onClick={() => changeHlsLevel(lvl.index)}
                      className={`w-full text-left px-2.5 py-1 rounded-md text-xs transition-colors ${
                        selectedLevel === lvl.index
                          ? 'bg-rose-600 text-white font-semibold'
                          : 'text-zinc-300 hover:bg-[#09090E]'
                      }`}
                    >
                      {lvl.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Audio Tracks Selector */}
            <div className="mt-3 pt-2.5 border-t border-[#262235]">
              <span className="block text-xs text-zinc-400 mb-1">অডিও ট্র্যাক (Audio Track)</span>
              {audioTracks.length > 1 ? (
                <div className="space-y-1">
                  {audioTracks.map((tr) => (
                    <button
                      key={tr.id}
                      onClick={() => changeHlsAudioTrack(tr.id)}
                      className={`w-full text-left px-2.5 py-1 rounded-md text-xs ${
                        selectedAudioTrack === tr.id
                          ? 'bg-rose-600 text-white'
                          : 'text-zinc-300 hover:bg-[#09090E]'
                      }`}
                    >
                      {tr.name} ({tr.lang})
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-zinc-400">
                  ডিফল্ট স্টিরিও অডিও ট্র্যাক সক্রিয় (সোর্সে অতিরিক্ত অডিও ট্র্যাক নেই)
                </p>
              )}
            </div>
          </div>
        )}

        {/* Bottom Scrim & Transport Controls */}
        <div className="inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/75 to-transparent px-4 pt-8 pb-3">
          {/* Interactive Timeline Scrubber */}
          <div className="relative flex items-center w-full h-5">
            <div className="absolute inset-x-0 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-zinc-600/60 transition-all duration-150"
                style={{ width: `${bufferedPercentage}%` }}
              />
            </div>
            <div
              className="pointer-events-none absolute left-0 h-1.5 rounded-full bg-rose-600"
              style={{ width: `${progressPercentage}%` }}
            />
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.05}
              value={currentTime}
              onChange={handleSeek}
              aria-label="Seek timeline"
              className="noir-slider relative z-10 w-full"
            />
          </div>

          {/* Primary Controls Bar */}
          <div className="mt-1 flex items-center justify-between gap-2">
            {/* Left Transport Cluster */}
            <div className="flex items-center gap-1 sm:gap-1.5">
              <button
                onClick={togglePlay}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-white hover:text-rose-400 hover:bg-zinc-800/60 transition-colors"
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
              </button>

              <button
                onClick={() => skipSeconds(-10)}
                aria-label="Rewind 10 seconds"
                title="১০ সেকেন্ড পেছনে (J)"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-zinc-300 hover:text-rose-400 hover:bg-zinc-800/60 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <button
                onClick={() => skipSeconds(10)}
                aria-label="Forward 10 seconds"
                title="১০ সেকেন্ড সামনে (L)"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-zinc-300 hover:text-rose-400 hover:bg-zinc-800/60 transition-colors"
              >
                <RotateCw className="w-4 h-4" />
              </button>

              {/* Frame-by-frame controls */}
              <button
                onClick={() => stepFrame(-1)}
                title="আগের ফ্রেম (,)"
                aria-label="Previous Frame"
                className="hidden md:flex min-h-[40px] min-w-[36px] items-center justify-center rounded-lg text-zinc-300 hover:text-rose-400 hover:bg-zinc-800/60 transition-colors"
              >
                <StepBack className="w-4 h-4" />
              </button>

              <button
                onClick={() => stepFrame(1)}
                title="পরের ফ্রেম (.)"
                aria-label="Next Frame"
                className="hidden md:flex min-h-[40px] min-w-[36px] items-center justify-center rounded-lg text-zinc-300 hover:text-rose-400 hover:bg-zinc-800/60 transition-colors"
              >
                <StepForward className="w-4 h-4" />
              </button>

              {/* Volume Cluster */}
              <div className="hidden sm:flex items-center gap-1.5">
                <button
                  onClick={toggleMute}
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-zinc-300 hover:text-rose-400 hover:bg-zinc-800/60 transition-colors"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4 text-rose-400" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  aria-label="Volume"
                  className="noir-slider w-20"
                />
              </div>

              {/* Tabular Timecode */}
              <div className="ml-2 text-xs font-mono tabular-nums text-zinc-300 whitespace-nowrap">
                <span className="text-white font-semibold">{formatTimecode(currentTime)}</span>
                <span className="mx-1 text-zinc-500">/</span>
                <span>{formatTimecode(duration)}</span>
              </div>
            </div>

            {/* Right Utility & Output Cluster */}
            <div className="flex items-center gap-1">
              <button
                onClick={handleToggleAbPoint}
                title="A-B Repeat Loop সেট করুন"
                className={`min-h-[40px] px-2 flex items-center justify-center rounded-lg text-xs font-mono font-semibold transition-colors whitespace-nowrap ${
                  abLoop.a !== null
                    ? 'text-rose-400 bg-rose-500/15 border border-rose-500/40'
                    : 'text-zinc-300 hover:text-white hover:bg-zinc-800/60'
                }`}
              >
                {abLoop.a === null ? 'A-B' : abLoop.b === null ? 'A→?' : 'A-B ON'}
              </button>

              <button
                onClick={() => setSubtitlesEnabled(!subtitlesEnabled)}
                title="সাবটাইটেল ও ক্যাপশন (CC)"
                aria-label="Toggle Subtitles"
                className={`min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg transition-colors ${
                  subtitlesEnabled
                    ? 'text-rose-400 bg-rose-500/15'
                    : 'text-zinc-300 hover:text-white hover:bg-zinc-800/60'
                }`}
              >
                <Subtitles className="w-4 h-4" />
              </button>

              <button
                onClick={() => setIsLooping(!isLooping)}
                title="লুপ প্লেব্যাক (Repeat)"
                aria-label="Toggle Loop"
                className={`min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg transition-colors ${
                  isLooping
                    ? 'text-rose-400 bg-rose-500/15'
                    : 'text-zinc-300 hover:text-white hover:bg-zinc-800/60'
                }`}
              >
                <Repeat className="w-4 h-4" />
              </button>

              <button
                onClick={captureFrameSnapshot}
                title="ফ্রেম স্ন্যাপশট সংরক্ষণ করুন (PNG)"
                aria-label="Capture Frame Snapshot"
                className="hidden sm:flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-zinc-300 hover:text-rose-400 hover:bg-zinc-800/60 transition-colors"
              >
                <Camera className="w-4 h-4" />
              </button>

              <button
                onClick={handleOrientationLock}
                title="স্ক্রিন ওরিয়েন্টেশন লক (Landscape)"
                aria-label="Lock Screen Orientation"
                className="hidden sm:flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-zinc-300 hover:text-rose-400 hover:bg-zinc-800/60 transition-colors"
              >
                <Smartphone className="w-4 h-4" />
              </button>

              <button
                onClick={togglePiP}
                title="Picture-in-Picture (PiP)"
                aria-label="Picture in Picture"
                className="hidden sm:flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-zinc-300 hover:text-rose-400 hover:bg-zinc-800/60 transition-colors"
              >
                <PictureInPicture2 className="w-4 h-4" />
              </button>

              <button
                onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                title="স্পিড, অডিও, সাবটাইটেল ও রেজোলিউশন"
                aria-label="Playback Settings"
                className={`min-h-[40px] px-2.5 flex items-center gap-1.5 rounded-lg text-xs font-mono tabular-nums transition-colors ${
                  showSettingsMenu
                    ? 'text-rose-400 bg-rose-500/15'
                    : 'text-zinc-300 hover:text-white hover:bg-zinc-800/60'
                }`}
              >
                <Sliders className="w-4 h-4" />
                <span>{playbackRate}x</span>
              </button>

              <button
                onClick={onToggleTheater}
                title="থিয়েটার মোড"
                className="hidden lg:flex min-h-[40px] px-2.5 items-center justify-center rounded-lg text-xs font-medium text-zinc-300 hover:text-rose-400 hover:bg-zinc-800/60 transition-colors whitespace-nowrap"
              >
                {theaterMode ? 'Standard' : 'Theater'}
              </button>

              <button
                onClick={toggleFullscreen}
                title="ফুলস্ক্রিন (F)"
                aria-label="Toggle Fullscreen"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-zinc-300 hover:text-rose-400 hover:bg-zinc-800/60 transition-colors"
              >
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Player Footer Metadata & Action Bar */}
      <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-t noir-border">
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-bold truncate">
            {video.title}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <span>{video.subtitle}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-rose-400">{video.format}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{activeResolution}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{video.sizeLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="text-violet-400">{video.license}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {onToggleFavorite && (
            <button
              onClick={() => onToggleFavorite(video)}
              className={`min-h-[42px] px-3.5 py-2 rounded-lg noir-subcard text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                isFavorite ? 'text-rose-400 border-rose-500/50' : 'hover:border-rose-500/40'
              }`}
            >
              <Heart className={`w-4 h-4 ${isFavorite ? 'fill-current text-rose-500' : ''}`} />
              <span>{isFavorite ? 'ফেভারিট করা আছে' : 'ফেভারিট'}</span>
            </button>
          )}

          <button
            onClick={() => onAddToPlaylist(video)}
            className="min-h-[42px] px-3.5 py-2 rounded-lg noir-subcard text-xs font-semibold hover:border-rose-500/50 transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <ListPlus className="w-4 h-4 text-rose-400" />
            <span>প্লেলিস্টে যুক্ত করুন</span>
          </button>

          <button
            onClick={() => onTriggerDownload(video)}
            className="min-h-[42px] px-4 py-2 rounded-lg bg-rose-600 text-xs font-semibold text-white hover:bg-rose-500 transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <Download className="w-4 h-4" />
            <span>কিউতে ডাউনলোড</span>
          </button>
        </div>
      </div>
    </div>
  );
};
