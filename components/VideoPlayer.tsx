import React, { useEffect, useRef, useState, useCallback } from 'react';
import { VideoSource, Subtitle, Season, MovieResult } from '../types';
import Hls from 'hls.js';
import SubtitleManager, { detectUserLanguage, findBestSubtitle } from './SubtitleManager';
import SeasonSelector from './SeasonSelector';
import BulkDownloadModal from './BulkDownloadModal';
import VideoPlayerBulkModalWrapper from './VideoPlayerBulkModalWrapper';
import { RetroTvError } from './RetroTvError';
import { fetchAndParseSrt, SrtCue } from '../utils/srtParser';
import { AudioSubtitleModal, AudioTrackItem } from './AudioSubtitleModal';
import { 
  CaptionSettings, 
  getStoredCaptionSettings, 
  getCaptionFontFamilyCss, 
  getCaptionBgCss, 
  getCaptionTextShadowCss 
} from '../utils/captionSettings';
export interface WatchPartyProps {
  isHost: boolean;
  viewersCount: number;
  viewersList: Array<{ id: string; name: string; isCreator?: boolean }>;
  inStreamChat?: { username: string; message: string } | null;
  pauseNotice?: string | null;
  onHostAction?: (action: 'play' | 'pause' | 'seek', time: number) => void;
  syncTime?: number;
  syncPaused?: boolean;
  syncTimestamp?: number;
  onOpenChatDrawer?: () => void;
}

export interface VideoPlayerProps {
  title: string;
  subTitle?: string;
  sources: VideoSource[];
  subtitles?: Subtitle[];
  onClose: () => void;
  minimized?: boolean;
  overlay?: boolean;
  embedded?: boolean;
  watchPartyProps?: WatchPartyProps;
  onToggleMinimize?: () => void;
  subjectId?: string;
  initialTime?: number;
  onProgressUpdate?: (time: number, duration: number) => void;
  nextEpisode?: { season: number; episode: number; title?: string; };
  onPlayNext?: () => void;
  isTrailer?: boolean;
  isLive?: boolean;
  startTime?: number;
  movie?: MovieResult;
  currentSeason?: number;
  currentEpisode?: number;
  onSeasonChange?: (season: number) => void;
  onEpisodeChange?: (season: number, episode: number) => void;
  showBulkDownload?: boolean;
  onToggleBulkDownload?: () => void;
  movieId?: string;
  seasonNumber?: number;
}
const formatTime = (seconds: number): string => {
  if (isNaN(seconds) || seconds === Infinity || seconds < 0) return "00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
};
const convertSrtToVtt = (srtContent: string): string => {
  if (srtContent.trim().startsWith('WEBVTT')) {
    return srtContent;
  }
  const normalized = srtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n\s*\n/);
  let vtt = 'WEBVTT\n\n';
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const lines = trimmed.split('\n');
    const convertedLines = lines.map(line => {
      const l = line.trim();
      if (l.includes('-->')) {
        return l.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2').replace(/,/g, '.');
      }
      return l;
    });
    vtt += convertedLines.join('\n') + '\n\n';
  }
  return vtt;
};
const vttBlobCache = new Map<string, string>();
const convertSrtUrlToVttBlob = async (srtUrl: string): Promise<string> => {
  if (vttBlobCache.has(srtUrl)) {
    return vttBlobCache.get(srtUrl)!;
  }
  try {
    let response: Response | undefined;
    try {
      response = await fetch(srtUrl);
    } catch (e) {
      try {
        response = await fetch(`/api/subtitle?url=${encodeURIComponent(srtUrl)}&format=raw`);
      } catch (err) {}
    }
    if (!response || !response.ok) {
      try {
        response = await fetch(`/api/subtitle?url=${encodeURIComponent(srtUrl)}&format=raw`);
      } catch (err) {}
    }
    if (!response || !response.ok) {
      return `/api/subtitle?url=${encodeURIComponent(srtUrl)}`;
    }
    const srtContent = await response.text();
    if (!srtContent.includes('-->') && !srtContent.includes('WEBVTT')) {
      return `/api/subtitle?url=${encodeURIComponent(srtUrl)}`;
    }
    const vttContent = convertSrtToVtt(srtContent);
    const blob = new Blob([vttContent], { type: 'text/vtt' });
    const blobUrl = URL.createObjectURL(blob);
    vttBlobCache.set(srtUrl, blobUrl);
    return blobUrl;
  } catch (error) {
    return `/api/subtitle?url=${encodeURIComponent(srtUrl)}`;
  }
};
const getYoutubeId = (url: string): string | null => {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
};
const FastStreamLoader: React.FC<{ buffered?: number }> = ({ buffered }) => {
  return (
    <div className="flex flex-col items-center p-8">
      <div className="relative">
        <div className="w-20 h-20 border-4 border-white/20 rounded-full animate-spin border-t-primary"></div>
        <div className="absolute inset-0 w-20 h-20 border-4 border-transparent rounded-full bg-gradient-to-r from-primary/20 to-transparent animate-spin-slow border-l-primary"></div>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-8 h-8 bg-gradient-to-br from-primary to-blue-500 rounded-full flex items-center justify-center shadow-lg">
            <svg className="w-5 h-5 text-black animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.665z"></path>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          </div>
        </div>
      </div>
      <div className="w-80 mt-8 mx-auto">
        <div className="relative h-3 bg-white/10 rounded-2xl overflow-hidden shadow-lg">
          <div className="absolute inset-0 bg-gradient-to-r from-gray-800/50 to-white/20 rounded-2xl"></div>
          <div 
            className="h-full bg-gradient-to-r from-primary via-blue-500 to-indigo-500 rounded-2xl relative shadow-primary/50 overflow-hidden transition-all duration-500 ease-out"
            style={{ width: `${Math.min((buffered || 0) * 100, 100)}%` }}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent transform translate-x-[-100%] animate-shimmer-smooth"></div>
          </div>
          {(buffered || 0) > 0 && (
            <div 
              className="absolute right-0 top-0 h-full w-1 bg-white/50 rounded-r-lg shadow-lg"
              style={{ right: `${100 - (buffered || 0) * 100}%` }}
            />
          )}
        </div>
      </div>
      <div className="mt-4 text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse-fast"></div>
          <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse-fast delay-100"></div>
          <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse-fast delay-200"></div>
        </div>
        <span className="text-white/80 text-sm font-medium tracking-wide">Loading Stream</span>
        {buffered && buffered > 0 && (
          <span className="text-primary/80 text-xs mt-1 block font-mono">
            {Math.round((buffered || 0) * 100)}% buffered
          </span>
        )}
      </div>
    </div>
  );
};
const TrailerPlayer: React.FC<{
  title: string;
  sources: VideoSource[];
  onClose: () => void;
  coverImage?: string;
}> = ({ title, sources, onClose, coverImage }) => {
  const trailerUrl = sources[0]?.stream || sources[0]?.direct || "";
  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center animate-fade-in">
      {coverImage && (
        <div 
          className="absolute inset-0 bg-cover bg-center blur-3xl opacity-40" 
          style={{ backgroundImage: `url(${coverImage})` }} 
        />
      )}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md"></div>
      <button 
        onClick={onClose} 
        className="absolute top-4 right-4 z-50 w-10 h-10 flex items-center justify-center bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors"
      >
        <i className="fa-solid fa-times"></i>
      </button>
      <div className="relative z-10 w-full max-w-4xl mx-4">
        <div className="aspect-video bg-black rounded-xl overflow-hidden shadow-2xl">
          {getYoutubeId(trailerUrl) ? (
            <iframe 
              src={`https://www.youtube.com/embed/${getYoutubeId(trailerUrl)}?rel=0`} 
              className="w-full h-full" 
              allowFullScreen 
              title={title} 
            />
          ) : (
            <video 
              src={trailerUrl} 
              controls 
              className="w-full h-full object-contain" 
            />
          )}
        </div>
        <div className="mt-4 text-center">
          <h2 className="text-white font-bold text-lg">{title}</h2>
        </div>
      </div>
    </div>
  );
};
const StreamingPlayer: React.FC<VideoPlayerProps> = ({ 
  title, 
  subTitle, 
  sources, 
  subtitles = [], 
  onClose, 
  minimized = false, 
  embedded = false,
  watchPartyProps,
  onToggleMinimize,
  initialTime = 0, 
  onProgressUpdate, 
  nextEpisode, 
  onPlayNext, 
  isLive = false,
  subjectId,
  movie,
  currentSeason = 1,
  currentEpisode = 1,
  onSeasonChange,
  onEpisodeChange
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(initialTime);
  const [duration, setDuration] = useState(0);
  const [isBuffering, setIsBuffering] = useState(true);
  const [buffered, setBuffered] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [locked, setLocked] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSourceSelect, setShowSourceSelect] = useState(false);
  const [showSeasonSelector, setShowSeasonSelector] = useState(false);
  const [showBulkDownload, setShowBulkDownload] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [resizeMode, setResizeMode] = useState<'contain' | 'cover'>('contain');
  const [activeSourceIndex, setActiveSourceIndex] = useState(() => {
    return 0;
  });
  const [preferredQuality, setPreferredQuality] = useState(() => {
    return localStorage.getItem('slflix_preferred_quality') || 'Auto';
  });
  const [activeSubtitle, setActiveSubtitle] = useState<number>(-1);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [pipError, setPipError] = useState<string | null>(null);
  const [convertedSubUrls, setConvertedSubUrls] = useState<Record<number, string>>({});
  const [isConvertingSubs, setIsConvertingSubs] = useState(false);
  const [networkState, setNetworkState] = useState<'good' | 'unstable' | 'offline'>('good');
  const [showNextCountdown, setShowNextCountdown] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [showReconnected, setShowReconnected] = useState(false);
  const [autoPlayNext, setAutoPlayNext] = useState(() => {
    return localStorage.getItem('slflix_autoplay_next') !== 'false';
  });
  const [needsUserGesture, setNeedsUserGesture] = useState(false);
  const hasTriggeredAutoPlayRef = useRef(false);
  const lastProgressUpdateRef = useRef<number>(0);
  const savedTimeRef = useRef<number>(initialTime || 0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);
  const wantsToPlayRef = useRef(true);

  // SRT Direct Overlay Subtitle Engine
  const [activeCues, setActiveCues] = useState<SrtCue[]>([]);
  const [activeSubtitleCue, setActiveSubtitleCue] = useState<string | null>(null);
  const [subtitleOffset, setSubtitleOffset] = useState<number>(0);
  const [subtitleFontSize, setSubtitleFontSize] = useState<'small' | 'medium' | 'large'>('medium');
  const [showAudioSubtitleModal, setShowAudioSubtitleModal] = useState(false);
  const [captionSettings, setCaptionSettings] = useState<CaptionSettings>(getStoredCaptionSettings);

  useEffect(() => {
    const handleCaptionSettingsChange = (e: any) => {
      if (e.detail) {
        setCaptionSettings(e.detail);
      } else {
        setCaptionSettings(getStoredCaptionSettings());
      }
    };
    window.addEventListener('slflix_caption_settings_change', handleCaptionSettingsChange);
    return () => {
      window.removeEventListener('slflix_caption_settings_change', handleCaptionSettingsChange);
    };
  }, []);

  // Audio Tracks Management
  const [audioTracks, setAudioTracks] = useState<AudioTrackItem[]>([]);
  const [activeAudioTrack, setActiveAudioTrack] = useState<number>(-1);

  // Seekbar Frame Preview
  const [isHoveringSeek, setIsHoveringSeek] = useState(false);
  const [hoverSeekPercent, setHoverSeekPercent] = useState(0);
  const [hoverSeekTime, setHoverSeekTime] = useState(0);

  // Landscape / Orientation State
  const [isForcedLandscape, setIsForcedLandscape] = useState(false);

  // Desktop HUD Toast
  const [hudToast, setHudToast] = useState<{ message: string; icon?: string } | null>(null);
  const hudToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Prevent controls fight
  const isHoveringControlsRef = useRef(false);

  const showHudToast = useCallback((message: string, icon?: string) => {
    setHudToast({ message, icon });
    if (hudToastTimerRef.current) clearTimeout(hudToastTimerRef.current);
    hudToastTimerRef.current = setTimeout(() => {
      setHudToast(null);
    }, 1400);
  }, []);

  const attemptPlay = useCallback(() => { 
    const video = videoRef.current; 
    if (!video || !wantsToPlayRef.current) return; 
    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.catch((error) => {
        if (error.name === 'NotAllowedError') {
          setNeedsUserGesture(true);
          setPlaying(false);
        } else {
          setPlaying(false);
        }
      });
    }
  }, []);

  // Fetch & Parse raw SRT file whenever activeSubtitle changes
  useEffect(() => {
    if (subtitles.length === 0 || activeSubtitle < 0) {
      setActiveCues([]);
      setActiveSubtitleCue(null);
      return;
    }
    const sub = subtitles[activeSubtitle];
    if (!sub || !sub.url) return;

    let isMounted = true;
    fetchAndParseSrt(sub.url).then(cues => {
      if (isMounted) {
        setActiveCues(cues);
      }
    }).catch(err => {
      console.warn('[VideoPlayer] Failed to parse SRT subtitles:', err);
    });

    return () => {
      isMounted = false;
    };
  }, [activeSubtitle, subtitles]);

  // Sync active subtitle cue based on video playback currentTime + subtitleOffset
  useEffect(() => {
    if (activeSubtitle < 0 || activeCues.length === 0) {
      if (activeSubtitleCue !== null) setActiveSubtitleCue(null);
      return;
    }
    const effectiveTime = currentTime + subtitleOffset;
    const cue = activeCues.find(c => effectiveTime >= c.start && effectiveTime <= c.end);
    const text = cue ? cue.text : null;
    if (text !== activeSubtitleCue) {
      setActiveSubtitleCue(text);
    }
  }, [currentTime, subtitleOffset, activeCues, activeSubtitle, activeSubtitleCue]);

  useEffect(() => {
    const handleOffline = () => setNetworkState('offline');
    const handleOnline = () => {
      setNetworkState('good');
      setShowReconnected(true);
      setTimeout(() => setShowReconnected(false), 3000);
      if (hlsRef.current) hlsRef.current.startLoad();
      if (videoRef.current && !playing) attemptPlay();
    };

    const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    const checkConnection = () => {
      if (!navigator.onLine) {
        setNetworkState('offline');
      } else if (conn) {
        if (conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g' || conn.downlink < 0.8) {
          setNetworkState('unstable');
        } else {
          setNetworkState('good');
        }
      }
    };

    checkConnection();
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    if (conn) {
      conn.addEventListener('change', checkConnection);
    }
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      if (conn) {
        conn.removeEventListener('change', checkConnection);
      }
    };
  }, [playing, attemptPlay]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (showNextCountdown && countdown > 0) {
      timer = setTimeout(() => setCountdown(c => c - 1), 1000);
    } else if (showNextCountdown && countdown === 0) {
      setShowNextCountdown(false);
      onPlayNext?.();
    }
    return () => clearTimeout(timer);
  }, [showNextCountdown, countdown, onPlayNext]);

  useEffect(() => {
    if (subtitles.length === 0 || activeSubtitle === -1) return;
    const convertActiveSubtitle = async () => {
      const sub = subtitles[activeSubtitle];
      if (sub && sub.url && !convertedSubUrls[activeSubtitle]) {
        setIsConvertingSubs(true);
        try {
          const vttUrl = await convertSrtUrlToVttBlob(sub.url);
          if (vttUrl !== sub.url) {
            setConvertedSubUrls(prev => ({ ...prev, [activeSubtitle]: vttUrl }));
          }
        } catch (e) {
          console.warn('[VideoPlayer] Failed to convert subtitle', activeSubtitle);
        }
        setIsConvertingSubs(false);
      }
    };
    convertActiveSubtitle();
  }, [subtitles, activeSubtitle, convertedSubUrls]);

  const toggleSubtitles = useCallback(() => {
    if (activeSubtitle >= 0) {
      setActiveSubtitle(-1);
      showHudToast('Subtitles Off', 'fa-solid fa-closed-captioning');
    } else if (subtitles.length > 0) {
      const best = findBestSubtitle(subtitles);
      const target = best >= 0 ? best : 0;
      setActiveSubtitle(target);
      const name = subtitles[target]?.name || 'English';
      showHudToast(`Subtitles: ${name}`, 'fa-solid fa-closed-captioning');
    } else {
      showHudToast('No subtitles available', 'fa-solid fa-circle-exclamation');
    }
  }, [activeSubtitle, subtitles, showHudToast]);

  const handleAudioTrackChange = useCallback((index: number) => {
    setActiveAudioTrack(index);
    if (hlsRef.current && index >= 0) {
      hlsRef.current.audioTrack = index;
    }
    const name = audioTracks[index]?.name || `Track ${index + 1}`;
    showHudToast(`Audio: ${name}`, 'fa-solid fa-volume-high');
  }, [audioTracks, showHudToast]);

  const toggleFullscreen = useCallback(() => {
    if (locked) return;
    if (!document.fullscreenElement && containerRef.current) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, [locked]);

  const togglePlay = useCallback(() => { 
    if (locked) return; 
    if (videoRef.current) {
      const willPlay = videoRef.current.paused;
      if (willPlay) {
        wantsToPlayRef.current = true;
        attemptPlay();
      } else {
        wantsToPlayRef.current = false;
        videoRef.current.pause();
      }
      if (watchPartyProps?.onHostAction) {
        watchPartyProps.onHostAction(willPlay ? 'play' : 'pause', videoRef.current.currentTime || 0);
      }
    }
  }, [locked, attemptPlay, watchPartyProps]);

  const skip = useCallback((seconds: number) => { 
    if (videoRef.current && !locked && !isLive) {
      const newTime = Math.max(0, Math.min(videoRef.current.currentTime + seconds, duration || Infinity));
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
      if (watchPartyProps?.onHostAction) {
        watchPartyProps.onHostAction('seek', newTime);
      }
    } 
  }, [locked, isLive, duration, watchPartyProps]);

  // Synchronize remote watch party actions (play, pause, seek)
  useEffect(() => {
    if (!watchPartyProps) return;
    const video = videoRef.current;
    if (!video) return;

    if (watchPartyProps.syncPaused !== undefined) {
      if (watchPartyProps.syncPaused) {
        wantsToPlayRef.current = false;
        if (!video.paused) {
          video.pause();
        }
        setPlaying(false);
        setIsBuffering(false);
      } else if (!watchPartyProps.syncPaused) {
        wantsToPlayRef.current = true;
        if (video.paused) {
          attemptPlay();
        }
      }
    }

    if (typeof watchPartyProps.syncTime === 'number' && watchPartyProps.syncTime >= 0) {
      const diff = Math.abs(video.currentTime - watchPartyProps.syncTime);
      if (diff > 2.5) {
        video.currentTime = watchPartyProps.syncTime;
        setCurrentTime(watchPartyProps.syncTime);
      }
    }
  }, [watchPartyProps?.syncPaused, watchPartyProps?.syncTime, watchPartyProps?.syncTimestamp, attemptPlay]);

  const toggleMute = useCallback(() => {
    setIsMuted(prev => !prev);
  }, []);

  const adjustVolume = useCallback((delta: number) => {
    setVolume(prev => {
      const next = Math.max(0, Math.min(1, Math.round((prev + delta) * 10) / 10));
      return next;
    });
    setIsMuted(false);
  }, []);

  // Desktop Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (minimized || locked) return;
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      switch(e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          togglePlay();
          showHudToast(playing ? 'Paused' : 'Playing', playing ? 'fa-solid fa-pause' : 'fa-solid fa-play');
          break;
        case 'ArrowRight':
        case 'l':
        case 'L':
          e.preventDefault();
          skip(10);
          showHudToast('+10s', 'fa-solid fa-rotate-right');
          break;
        case 'ArrowLeft':
        case 'j':
        case 'J':
          e.preventDefault();
          skip(-10);
          showHudToast('-10s', 'fa-solid fa-rotate-left');
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          showHudToast(!document.fullscreenElement ? 'Fullscreen' : 'Exit Fullscreen', 'fa-solid fa-expand');
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          toggleMute();
          showHudToast(!isMuted ? 'Muted' : 'Unmuted', !isMuted ? 'fa-solid fa-volume-xmark' : 'fa-solid fa-volume-high');
          break;
        case 'c':
        case 'C':
          e.preventDefault();
          toggleSubtitles();
          break;
        case 'ArrowUp':
          e.preventDefault();
          adjustVolume(0.1);
          showHudToast(`Volume ${Math.round(Math.min(1, volume + 0.1) * 100)}%`, 'fa-solid fa-volume-high');
          break;
        case 'ArrowDown':
          e.preventDefault();
          adjustVolume(-0.1);
          showHudToast(`Volume ${Math.round(Math.max(0, volume - 0.1) * 100)}%`, 'fa-solid fa-volume-low');
          break;
        case '0': case '1': case '2': case '3': case '4':
        case '5': case '6': case '7': case '8': case '9':
          if (duration > 0 && !isLive) {
            e.preventDefault();
            const pct = parseInt(e.key, 10) / 10;
            const targetTime = pct * duration;
            if (videoRef.current) {
              videoRef.current.currentTime = targetTime;
              setCurrentTime(targetTime);
              showHudToast(`Seek: ${Math.round(pct * 100)}%`, 'fa-solid fa-forward');
            }
          }
          break;
        case 'Escape':
          if (showAudioSubtitleModal) setShowAudioSubtitleModal(false);
          else if (showSeasonSelector) setShowSeasonSelector(false);
          else if (showSettings) setShowSettings(false);
          else if (showSourceSelect) setShowSourceSelect(false);
          else onClose();
          break;
      }
    };
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [playing, minimized, locked, showSettings, showSourceSelect, showSeasonSelector, showAudioSubtitleModal, isMuted, volume, duration, isLive, togglePlay, skip, toggleFullscreen, toggleMute, toggleSubtitles, adjustVolume, onClose, showHudToast]);

  useEffect(() => {
    if (subtitles.length > 0 && activeSubtitle === -1) {
      const bestSubtitle = findBestSubtitle(subtitles);
      if (bestSubtitle >= 0) {
        setActiveSubtitle(bestSubtitle);
      }
    }
  }, [subtitles]);
  const lockToLandscape = useCallback(async () => {
    try {
      if (typeof screen !== 'undefined' && screen.orientation && 'lock' in screen.orientation) {
        await (screen.orientation as any).lock('landscape').catch(() => {});
      }
    } catch (e) {}
  }, []);

  const unlockOrientation = useCallback(() => {
    try {
      if (typeof screen !== 'undefined' && screen.orientation && 'unlock' in screen.orientation) {
        screen.orientation.unlock();
      }
    } catch (e) {}
  }, []);

  const toggleLandscape = useCallback(async () => {
    if (locked) return;
    const nextState = !isForcedLandscape;
    setIsForcedLandscape(nextState);
    if (nextState) {
      await lockToLandscape();
      showHudToast('Landscape Mode On', 'fa-solid fa-mobile-screen-button');
    } else {
      unlockOrientation();
      showHudToast('Landscape Mode Off', 'fa-solid fa-mobile-screen-button');
    }
  }, [locked, isForcedLandscape, lockToLandscape, unlockOrientation, showHudToast]);

  useEffect(() => {
    lockToLandscape();
    return () => {
      unlockOrientation();
    };
  }, [lockToLandscape, unlockOrientation]);

  const updateBuffered = useCallback(() => {
    const video = videoRef.current;
    if (video && video.buffered.length > 0) {
      const bufferedEnd = video.buffered.end(video.buffered.length - 1);
      setBuffered(bufferedEnd);
    }
  }, []);

  const initHls = useCallback(() => {
    if (!hlsRef.current && Hls.isSupported()) {
      const hls = new Hls({
        capLevelToPlayerSize: true,
        autoStartLoad: true,
        debug: false,
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        maxBufferSize: 120 * 1024 * 1024,
        backBufferLength: 60,
        enableWorker: true,
        startLevel: -1,
        fragLoadingMaxRetry: 10,
        manifestLoadingMaxRetry: 10,
        levelLoadingMaxRetry: 10,
        maxBufferHole: 0.3,
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.1,
        nudgeMaxRetry: 8,
        lowLatencyMode: false
      });
      hlsRef.current = hls;

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsBuffering(false);
        if (hls.audioTracks && hls.audioTracks.length > 0) {
          setAudioTracks(hls.audioTracks.map((t, idx) => ({
            id: idx,
            name: t.name || `Audio Track ${idx + 1}`,
            lang: t.lang
          })));
          setActiveAudioTrack(hls.audioTrack);
        }
        const video = videoRef.current;
        if (video) {
          if (savedTimeRef.current > 0) {
            try {
              video.currentTime = savedTimeRef.current;
            } catch (e) {}
          }
          video.playbackRate = playbackSpeed;
          if (wantsToPlayRef.current) attemptPlay();
        }
      });
      hls.on(Hls.Events.LEVEL_LOADED, () => {
        setIsBuffering(false);
        const video = videoRef.current;
        if (video && savedTimeRef.current > 0) {
          if (Math.abs(video.currentTime - savedTimeRef.current) > 1.5) {
            try {
              video.currentTime = savedTimeRef.current;
            } catch (e) {}
          }
        }
      });
      hls.on(Hls.Events.FRAG_LOADED, () => {
        setIsBuffering(false);
        updateBuffered();
      });
      hls.on(Hls.Events.ERROR, (_, data) => { 
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (navigator.onLine) {
            setNetworkState('unstable');
            setTimeout(() => setNetworkState(prev => prev === 'unstable' ? 'good' : prev), 5000);
          }
          if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR || 
              data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR ||
              data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR) {
            hls.startLoad();
          }
        }
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          } else {
            setVideoError('Fatal playback error. Please try another source.');
          }
        }
      });
    }
    
    const hls = hlsRef.current;
    if (hls && videoRef.current && hls.media !== videoRef.current) {
       hls.attachMedia(videoRef.current);
    }
    return hls;
  }, [playbackSpeed, attemptPlay, updateBuffered]);

  const loadSource = useCallback((source: VideoSource, sourceIndex: number, startTimeOverride?: number) => {
    const video = videoRef.current;
    if (!video) return;
    
    setIsBuffering(true);
    setVideoError(null);
    setActiveSourceIndex(sourceIndex);
    
    // Capture exact playback position before switching
    const currentPos = startTimeOverride !== undefined 
      ? startTimeOverride 
      : ((video.currentTime && video.currentTime > 0) ? video.currentTime : (currentTime > 0 ? currentTime : savedTimeRef.current));
    
    savedTimeRef.current = currentPos;
    wantsToPlayRef.current = true; // maintain playback state on quality switch
    
    if (source.quality) {
      const qStr = String(source.quality);
      setPreferredQuality(qStr);
      localStorage.setItem('slflix_preferred_quality', qStr);
    }
    
    const url = source.stream || source.direct || source.download;
    if (!url) return;
    
    const isHlsStream = source.type === 'hls' || url.includes('.m3u8');
    
    const restoreTimeAndPlay = () => {
      if (savedTimeRef.current > 0 && video) {
        try {
          video.currentTime = savedTimeRef.current;
        } catch (e) {}
      }
      if (video) {
        video.playbackRate = playbackSpeed;
        updateBuffered();
      }
      if (wantsToPlayRef.current) attemptPlay();
    };

    if (isHlsStream && video.canPlayType('application/vnd.apple.mpegurl')) {
      if (hlsRef.current) {
        hlsRef.current.detachMedia();
      }
      video.onloadedmetadata = restoreTimeAndPlay;
      video.oncanplay = () => {
        restoreTimeAndPlay();
        setIsBuffering(false);
      };
      video.src = url;
    } else if (Hls.isSupported() && isHlsStream) {
      const hls = initHls();
      if (hls) {
        if (video.src && !video.src.startsWith('blob:')) {
          video.removeAttribute('src');
          video.load();
        }
        if (hls.config) {
          hls.config.startPosition = savedTimeRef.current > 0 ? savedTimeRef.current : -1;
        }
        hls.loadSource(url);
        hls.startLoad(savedTimeRef.current > 0 ? savedTimeRef.current : -1);
      }
    } else {
      if (hlsRef.current) {
        hlsRef.current.detachMedia();
      }
      video.onloadedmetadata = restoreTimeAndPlay;
      video.oncanplay = () => {
        restoreTimeAndPlay();
        setIsBuffering(false);
      };
      video.onerror = () => {
        setVideoError('Failed to load video. Please try another source.');
        setIsBuffering(false);
      };
      video.src = url;
    }
  }, [playbackSpeed, attemptPlay, updateBuffered, initHls, currentTime]);

  const sourcesStr = JSON.stringify(sources);
  useEffect(() => { 
    hasTriggeredAutoPlayRef.current = false;

    // Auto-resume lookup across subjectId and normalized base title
    if (!isLive) {
      const normalizeTitle = (t: string) => {
        if (!t) return '';
        return t
          .toLowerCase()
          .replace(/\s*\((\d+p|dub|sub|indohd|uncensored|bd|english)\)\s*/gi, '')
          .replace(/\s*\[([^\]]+)\]\s*/g, '')
          .replace(/[^a-z0-9]/g, '')
          .trim();
      };

      const keysToCheck = [];
      if (subjectId) keysToCheck.push(`slflix_progress_${subjectId}`);
      if (title) keysToCheck.push(`slflix_progress_base_${normalizeTitle(title)}`);

      let foundTime = 0;
      for (const k of keysToCheck) {
        const data = localStorage.getItem(k);
        if (data) {
          try {
            const parsed = JSON.parse(data);
            const epKey = `S${currentSeason || 1}E${currentEpisode || 1}`;
            const epData = parsed[epKey];
            if (epData && epData.time > 10) {
              if (epData.duration && epData.time >= epData.duration - 10) {
                foundTime = 0;
              } else {
                foundTime = epData.time;
                break;
              }
            }
          } catch (e) {}
        }
      }

      if (foundTime > 0) {
        savedTimeRef.current = foundTime;
      } else {
        savedTimeRef.current = initialTime || 0;
      }
    }

    if (sources.length > 0) {
      let targetIndex = 0;
      if (preferredQuality && preferredQuality !== 'Auto') {
        const index = sources.findIndex(s => String(s.quality) === preferredQuality);
        if (index !== -1) {
          targetIndex = index;
        }
      }
      loadSource(sources[targetIndex], targetIndex); 
    }
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcesStr, subjectId, currentSeason, currentEpisode, isLive]);

  useEffect(() => {
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, []);
  useEffect(() => { 
    if (videoRef.current) videoRef.current.playbackRate = playbackSpeed; 
  }, [playbackSpeed]);
  useEffect(() => { 
    if (videoRef.current) { 
      videoRef.current.volume = volume; 
      videoRef.current.muted = isMuted; 
    } 
  }, [volume, isMuted]);
  const handleSubtitleChange = useCallback((index: number) => {
    setActiveSubtitle(index);
    if (videoRef.current) {
      const tracks = videoRef.current.textTracks;
      for (let i = 0; i < tracks.length; i++) {
        tracks[i].mode = (i === index) ? 'showing' : 'hidden';
      }
    }
  }, []);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || subtitles.length === 0) return;
    const initSubtitles = () => {
      if (activeSubtitle >= 0 && video.textTracks.length > activeSubtitle) {
        for (let i = 0; i < video.textTracks.length; i++) {
          video.textTracks[i].mode = (i === activeSubtitle) ? 'showing' : 'hidden';
        }
      } else {
         for (let i = 0; i < video.textTracks.length; i++) {
            video.textTracks[i].mode = 'hidden';
         }
      }
    };
    if (video.readyState >= 1) {
      setTimeout(initSubtitles, 500);
    } else {
      video.addEventListener('loadedmetadata', () => {
        setTimeout(initSubtitles, 500);
      }, { once: true });
    }
    initSubtitles();
  }, [subtitles, activeSubtitle]);

  const resetControlsTimeout = useCallback(() => {
    if (minimized) return;
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (!locked && playing && !isHoveringControlsRef.current && !showSettings && !showSourceSelect && !showSeasonSelector && !showAudioSubtitleModal) {
      controlsTimeoutRef.current = setTimeout(() => { 
        if (!isHoveringControlsRef.current && !showSettings && !showSourceSelect && !showSeasonSelector && !showAudioSubtitleModal && !isDragging) {
          setShowControls(false); 
        }
      }, 3500);
    }
  }, [minimized, locked, playing, showSettings, showSourceSelect, showSeasonSelector, showAudioSubtitleModal, isDragging]);

  const handleMouseMove = useCallback(() => {
    resetControlsTimeout();
  }, [resetControlsTimeout]);

  // Auto-schedule control fadeout on playing state changes
  useEffect(() => {
    if (playing) {
      resetControlsTimeout();
    }
  }, [playing, resetControlsTimeout]);

  const handleSeekMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration || isLive || locked) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(100, (rawX / rect.width) * 100));
    const time = (percent / 100) * duration;
    setHoverSeekPercent(percent);
    setHoverSeekTime(time);
    setIsHoveringSeek(true);
  }, [duration, isLive, locked]);

  const handleVideoAreaTouchOrClick = useCallback((e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if (locked) return;
    setShowControls(prev => {
      const next = !prev;
      if (next && playing) {
        resetControlsTimeout();
      }
      return next;
    });
  }, [locked, playing, resetControlsTimeout]);

  const cycleSpeed = useCallback(() => { 
    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const currentIndex = speeds.indexOf(playbackSpeed);
    const nextIndex = (currentIndex + 1) % speeds.length;
    setPlaybackSpeed(speeds[nextIndex]);
  }, [playbackSpeed]);

  const handleDownload = useCallback((source: VideoSource) => { 
    const link = source.download || source.direct || source.stream; 
    if (link) {
      const cleanTitle = (title || 'video').replace(/[^a-zA-Z0-9]/g, '_');
      const seasonEp = currentSeason && currentEpisode ? `_S${String(currentSeason).padStart(2, '0')}E${String(currentEpisode).padStart(2, '0')}` : '';
      const qualityStr = source.quality ? `_${source.quality}p` : '';
      const filename = `${cleanTitle}${seasonEp}${qualityStr}_SLFLIX.mp4`;

      const anchor = document.createElement('a');
      anchor.href = link;
      anchor.target = '_blank';
      anchor.setAttribute('download', filename);
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    }
  }, [title, currentSeason, currentEpisode]);

  // Background playback & auto-PiP when leaving Chrome / minimizing
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.hidden && playing && videoRef.current) {
        try {
          if (document.pictureInPictureEnabled && !document.pictureInPictureElement) {
            await videoRef.current.requestPictureInPicture();
          }
        } catch (e) {
          console.warn('[PiP] Auto-PiP on leave failed:', e);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [playing]);
  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || !duration || locked) return;
    const rect = progressRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newTime = pos * duration;
    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  }, [duration, locked]);

  const isDraggingRef = useRef(false);
  const seekTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const togglePiP = useCallback(async () => {
    const video = videoRef.current as any;
    if (!video) return;

    if (video.readyState === 0) {
      showHudToast('Video is loading...', 'fa-solid fa-spinner');
      return;
    }

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        showHudToast('Exited Picture in Picture', 'fa-solid fa-compress');
        return;
      }

      if (typeof video.requestPictureInPicture === 'function') {
        await video.requestPictureInPicture();
        showHudToast('Picture in Picture enabled', 'fa-solid fa-clone');
        return;
      } else if (video.webkitSupportsPresentationMode && typeof video.webkitSetPresentationMode === "function") {
        const currentMode = video.webkitPresentationMode;
        const targetMode = currentMode === "picture-in-picture" ? "inline" : "picture-in-picture";
        video.webkitSetPresentationMode(targetMode);
        showHudToast('Picture in Picture toggled', 'fa-solid fa-clone');
        return;
      }
    } catch (error: any) {
      console.warn('Native PiP not available, using in-app floating player:', error?.message);
    }

    if (onToggleMinimize) {
      onToggleMinimize();
      showHudToast(minimized ? 'Expanded Player' : 'Mini Player enabled', 'fa-solid fa-clone');
    } else {
      showHudToast('Picture in Picture unavailable in this browser', 'fa-solid fa-circle-exclamation');
    }
  }, [minimized, onToggleMinimize, showHudToast]);

  const handleSeekStart = useCallback(() => {
    isDraggingRef.current = true;
    setIsDragging(true);
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
    }
  }, []);

  const handleSeekEnd = useCallback((e?: React.MouseEvent | React.TouchEvent | any) => {
    isDraggingRef.current = false;
    setIsDragging(false);
    if (seekTimeoutRef.current) {
      clearTimeout(seekTimeoutRef.current);
    }
    const slider = e?.target as HTMLInputElement;
    if (slider && videoRef.current) {
       const finalTime = parseFloat(slider.value);
       videoRef.current.currentTime = finalTime;
       savedTimeRef.current = finalTime;
    }
    
    if (wantsToPlayRef.current) {
      attemptPlay();
    }
  }, [attemptPlay]);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (locked || !duration) return;
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    savedTimeRef.current = time;
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      videoRef.current.play().catch(() => {});
    }
    if (watchPartyProps?.onHostAction) {
      watchPartyProps.onHostAction('seek', time);
    }
  }, [locked, duration, watchPartyProps]);

  const handleSeasonChange = useCallback((season: number) => {
    onSeasonChange?.(season);
  }, [onSeasonChange]);
  const handleEpisodeSelect = useCallback((season: number, episode: number) => {
    onEpisodeChange?.(season, episode);
    setShowSeasonSelector(false);
  }, [onEpisodeChange]);
  const bufferedPercent = duration > 0 ? (buffered / duration) * 100 : 0;
  const playedPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const rawMovieType = String(movie?.type || '').toLowerCase();
  const isExplicitMovie = rawMovieType === 'movie' || rawMovieType.includes('feature');
  const isSeries = !isExplicitMovie && Boolean(
    rawMovieType.includes('series') || 
    rawMovieType.includes('tv') || 
    rawMovieType.includes('anime') || 
    rawMovieType.includes('show') || 
    rawMovieType.includes('drama') || 
    (movie?.seasons && movie.seasons.length > 0 && (movie.seasons.length > 1 || (movie.seasons[0]?.episodeCount || 0) > 1))
  );

  return (
    <div 
      ref={containerRef} 
      className={minimized 
        ? "fixed bottom-4 right-4 w-[320px] aspect-video z-[2000] bg-black shadow-2xl rounded-xl overflow-hidden cursor-pointer" 
        : (embedded && !isFullscreen)
          ? "relative w-full aspect-video bg-black rounded-2xl overflow-hidden group shadow-2xl border border-white/10 select-none"
          : "fixed inset-0 z-[2000] bg-black group overflow-hidden"
      } 
      style={isForcedLandscape ? {
        transform: 'rotate(90deg)',
        transformOrigin: 'top left',
        width: '100vh',
        height: '100vw',
        position: 'fixed',
        top: 0,
        left: '100vw',
        zIndex: 2500
      } : undefined}
      onMouseMove={handleMouseMove} 
      onMouseLeave={() => playing && !showSettings && !showSourceSelect && !showSeasonSelector && setShowControls(false)} 
      onClick={minimized ? onToggleMinimize : undefined} 
      onDoubleClick={toggleFullscreen}
    >
      <video 
        ref={videoRef} 
        preload="auto" 
        className={`w-full h-full bg-black ${resizeMode === 'cover' ? 'object-cover' : 'object-contain'}`} 
        playsInline 
        onTimeUpdate={(e) => { 
          if (isDraggingRef.current) return;
          const curr = e.currentTarget.currentTime;
          const dur = e.currentTarget.duration;
          setCurrentTime(curr); 
          savedTimeRef.current = curr;
          updateBuffered(); 
          const now = Date.now();
          if (dur > 0 && (!lastProgressUpdateRef.current || now - lastProgressUpdateRef.current > 5000)) {
            if (onProgressUpdate) {
              onProgressUpdate(curr, dur); 
            }
            if (!isLive && title) {
               const normalizeTitle = (t: string) => {
                 if (!t) return '';
                 return t
                   .toLowerCase()
                   .replace(/\s*\((\d+p|dub|sub|indohd|uncensored|bd|english)\)\s*/gi, '')
                   .replace(/\s*\[([^\]]+)\]\s*/g, '')
                   .replace(/[^a-z0-9]/g, '')
                   .trim();
               };
               const epKey = `S${currentSeason || 1}E${currentEpisode || 1}`;
               const payload = {
                 time: curr,
                 duration: dur,
                 lastWatchedAt: Date.now()
               };

               if (subjectId) {
                 const key = `slflix_progress_${subjectId}`;
                 let parsed: Record<string, any> = {};
                 try {
                   const data = localStorage.getItem(key);
                   if (data) parsed = JSON.parse(data);
                 } catch (e) {}
                 parsed[epKey] = payload;
                 localStorage.setItem(key, JSON.stringify(parsed));
               }

               const baseKey = `slflix_progress_base_${normalizeTitle(title)}`;
               let baseParsed: Record<string, any> = {};
               try {
                 const data = localStorage.getItem(baseKey);
                 if (data) baseParsed = JSON.parse(data);
               } catch (e) {}
               baseParsed[epKey] = payload;
               localStorage.setItem(baseKey, JSON.stringify(baseParsed));
            }
            lastProgressUpdateRef.current = now;
          }
          if (
            autoPlayNext &&
            dur > 0 &&
            curr / dur >= 0.95 &&
            !hasTriggeredAutoPlayRef.current &&
            nextEpisode &&
            onPlayNext
          ) {
            hasTriggeredAutoPlayRef.current = true;
            onPlayNext();
          }
        }}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onWaiting={() => setIsBuffering(true)}
        onCanPlay={() => setIsBuffering(false)}
        onPlaying={() => { setIsBuffering(false); setPlaying(true); }}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onEnded={() => { 
          if (nextEpisode && onPlayNext) {
            setShowNextCountdown(true);
            setCountdown(5);
          } else {
            onClose(); 
          }
        }}
        onProgress={() => updateBuffered()}
        onError={(e) => {
          e.preventDefault();
          setVideoError('Failed to load video. Please try another source.');
          setIsBuffering(false);
        }}
      >
      </video>

      {/* Video Area Single Touch/Click Interactive Layer */}
      <div 
        className="absolute inset-0 z-20 cursor-pointer select-none"
        onClick={handleVideoAreaTouchOrClick}
        onTouchEnd={handleVideoAreaTouchOrClick}
      />

      {/* Direct SRT Subtitle Overlay */}
      {activeSubtitleCue && !minimized && (
        <div 
          className={`absolute left-1/2 -translate-x-1/2 text-center pointer-events-none z-30 transition-all duration-200 px-4 max-w-[92%] md:max-w-[80%] ${
            showControls ? 'bottom-24 md:bottom-28' : 'bottom-8 md:bottom-12'
          }`}
        >
          <div 
            style={{
              fontFamily: getCaptionFontFamilyCss(captionSettings.fontFamily),
              backgroundColor: getCaptionBgCss(captionSettings.bgColor, captionSettings.bgOpacity),
              color: captionSettings.fontColor,
              textShadow: getCaptionTextShadowCss(captionSettings.textShadow, captionSettings.textOutline, captionSettings.fontColor)
            }}
            className={`inline-block rounded-xl shadow-2xl tracking-wide select-none leading-relaxed border border-white/10 backdrop-blur-[2px] px-3.5 py-1.5 ${
              captionSettings.fontWeight === 'bold' 
                ? 'font-bold' 
                : captionSettings.fontWeight === 'black' 
                  ? 'font-black' 
                  : 'font-semibold'
            } ${
              captionSettings.fontSize === 'small' || subtitleFontSize === 'small'
                ? 'text-sm md:text-base' 
                : captionSettings.fontSize === 'large' || subtitleFontSize === 'large'
                  ? 'text-xl md:text-2xl lg:text-3xl' 
                  : captionSettings.fontSize === 'xlarge'
                    ? 'text-2xl md:text-3xl lg:text-4xl'
                    : 'text-base md:text-xl lg:text-2xl'
            }`}
          >
            {activeSubtitleCue.split('\n').map((line, idx) => (
              <div key={idx}>
                {line}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Desktop Keyboard HUD Toast Feedback */}
      {hudToast && (
        <div className="absolute top-8 left-1/2 -translate-x-1/2 z-[200] bg-black/90 backdrop-blur-md border border-white/20 text-white px-5 py-2.5 rounded-2xl text-sm font-bold flex items-center gap-3 shadow-2xl animate-fade-in pointer-events-none">
          {hudToast.icon && <i className={`${hudToast.icon} text-primary text-base`}></i>}
          <span>{hudToast.message}</span>
        </div>
      )}
      
      {needsUserGesture && !minimized && (
        <div className="absolute inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <button 
            onClick={() => {
              setNeedsUserGesture(false);
              wantsToPlayRef.current = true;
              const video = videoRef.current;
              if (video) video.play().catch(() => {});
            }}
            className="w-24 h-24 bg-primary text-black rounded-full flex items-center justify-center hover:scale-110 transition-transform shadow-2xl shadow-primary/50"
          >
            <i className="fa-solid fa-play text-4xl ml-2"></i>
          </button>
        </div>
      )}

      {isBuffering && networkState !== 'offline' && (
        <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/80">
          <FastStreamLoader buffered={bufferedPercent / 100} />
        </div>
      )}
      {videoError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-[100]">
          <RetroTvError errorCode="ERR" errorMessage="STREAM FAULT" className="scale-75 md:scale-100" />
          <p className="mt-4 text-gray-400 font-mono text-xs max-w-sm text-center">{videoError}</p>
          <button 
            onClick={() => setVideoError(null)}
            className="mt-6 px-6 py-2 bg-primary text-black font-bold rounded-lg hover:scale-105 transition-transform"
          >
            RETRY CONNECTION
          </button>
        </div>
      )}
      {pipError && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[3000] bg-black/90 border border-white/10 text-white px-4 py-3 rounded-xl text-sm font-bold flex items-center gap-3 shadow-2xl animate-fade-in-down">
          <i className="fa-solid fa-circle-exclamation text-yellow-500"></i>
          {pipError}
        </div>
      )}
      {showSourceSelect && (
        <div 
          className="absolute inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in" 
          onClick={() => setShowSourceSelect(false)}
        >
          <div 
            className="bg-[#12121a] border border-white/10 rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl transition-all transform scale-100" 
            onClick={e => e.stopPropagation()}
          >
            <div className="p-5 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-primary/10 to-transparent">
              <div>
                <h3 className="text-lg font-black text-white tracking-tight">Select Quality</h3>
                <p className="text-gray-500 text-[10px] uppercase tracking-widest font-bold">Fast Streaming</p>
              </div>
              <button 
                onClick={() => setShowSourceSelect(false)} 
                className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-gray-400 hover:text-white transition-all"
              >
                <i className="fa-solid fa-times"></i>
              </button>
            </div>
            <div className="p-4 space-y-2 max-h-[60vh] overflow-y-auto scrollbar-hide">
              {sources.map((s, i) => (
                <div key={i} className="flex gap-2 group animate-slide-up" style={{ animationDelay: `${i * 40}ms` }}>
                  <button 
                    onClick={() => { 
                      const currentPos = (videoRef.current?.currentTime && videoRef.current.currentTime > 0)
                        ? videoRef.current.currentTime
                        : (currentTime > 0 ? currentTime : savedTimeRef.current);
                      loadSource(s, i, currentPos); 
                      setShowSourceSelect(false); 
                      showHudToast(`Quality: ${String(s.quality).toUpperCase().replace('P', '')}P`, 'fa-solid fa-sliders');
                    }} 
                    className={`flex-1 p-4 rounded-2xl text-left flex items-center justify-between transition-all border ${
                        activeSourceIndex === i 
                        ? 'bg-primary border-primary shadow-[0_0_20px_rgba(0,229,255,0.3)] text-black' 
                        : 'bg-white/5 border-white/5 text-white hover:bg-white/10 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                        <div className={`w-10 h-7 rounded-lg flex items-center justify-center font-bold text-[10px] ${
                            activeSourceIndex === i ? 'bg-black/20' : 'bg-white/10'
                        }`}>
                            {String(s.quality).toUpperCase().replace('P', '')}P
                        </div>
                        <div>
                            <span className="font-bold text-sm block">{s.label || 'Standard Stream'}</span>
                            <span className="text-[10px] text-gray-400 font-mono">
                                {s.size || (
                                    String(s.quality).toLowerCase().includes('orig') || String(s.quality).includes('1080') ? '1.8 GB' :
                                    String(s.quality).includes('720') ? '950 MB' :
                                    String(s.quality).includes('480') ? '450 MB' : '320 MB'
                                )}
                            </span>
                        </div>
                    </div>
                    {activeSourceIndex === i && <i className="fa-solid fa-check text-xs"></i>}
                  </button>
                  <div className="flex flex-col items-center justify-center gap-0.5">
                    <button 
                      onClick={() => handleDownload(s)} 
                      className="w-12 h-10 rounded-xl bg-white/5 hover:bg-emerald-500/20 text-gray-400 hover:text-emerald-500 border border-white/5 hover:border-emerald-500/30 transition-all flex items-center justify-center"
                      title="Download"
                    >
                      <i className="fa-solid fa-download text-sm"></i>
                    </button>
                    <span className="text-[9px] font-black text-emerald-400 font-mono tracking-tight whitespace-nowrap">
                      {s.size || (
                        String(s.quality).toLowerCase().includes('orig') || String(s.quality).includes('1080') ? '1.8 GB' :
                        String(s.quality).includes('720') ? '950 MB' :
                        String(s.quality).includes('480') ? '450 MB' : '320 MB'
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 bg-black/20 text-center">
                 <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Multi-Source Engine Enabled</p>
            </div>
          </div>
        </div>
      )}
      {showSettings && (
        <div 
          className="absolute inset-0 z-[80] bg-black/90 flex items-center justify-center p-4" 
          onClick={() => setShowSettings(false)}
        >
          <div 
            className="bg-[#1a1a2e] rounded-xl p-4 w-full max-w-md max-h-[80vh] overflow-y-auto" 
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-white font-bold">Settings</h3>
              <button 
                onClick={() => setShowSettings(false)} 
                className="text-gray-400 hover:text-white"
              >
                <i className="fa-solid fa-times"></i>
              </button>
            </div>
            <div className="mb-4">
              <p className="text-gray-400 text-xs uppercase mb-2 flex items-center gap-2">
                <i className="fa-solid fa-closed-captioning"></i> Subtitles
              </p>
              <div className="flex flex-wrap gap-2">
                {subtitles.length > 0 ? (
                  <SubtitleManager
                    videoElement={videoRef.current}
                    subtitles={subtitles.map((sub, i) => ({ ...sub, url: convertedSubUrls[i] || '' }))}
                    onSubtitleChange={handleSubtitleChange}
                    activeSubtitle={activeSubtitle}
                  />
                ) : (
                  <span className="text-white/50 text-xs">No subtitles available</span>
                )}
              </div>
            </div>
            {isSeries && movie && (
              <div className="mb-4">
                <p className="text-gray-400 text-xs uppercase mb-2 flex items-center gap-2">
                  <i className="fa-solid fa-layer-group"></i> Episodes
                </p>
                <SeasonSelector
                  movie={movie}
                  currentSeason={currentSeason}
                  currentEpisode={currentEpisode}
                  onSeasonChange={handleSeasonChange}
                  onEpisodeSelect={handleEpisodeSelect}
                />
              </div>
            )}
            <div className="mb-4">
              <p className="text-gray-400 text-xs uppercase mb-2 flex items-center gap-2">
                <i className="fa-solid fa-gauge"></i> Speed
              </p>
              <div className="flex gap-2 flex-wrap">
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map(s => (
                  <button 
                    key={s} 
                    onClick={() => setPlaybackSpeed(s)} 
                    className={`px-4 py-1.5 rounded text-xs ${playbackSpeed === s ? 'bg-primary text-black' : 'bg-white/10 text-white'}`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-gray-400 text-xs uppercase mb-2 flex items-center gap-2">
                <i className="fa-solid fa-expand"></i> Screen
              </p>
              <div className="flex gap-2">
                <button 
                  onClick={() => setResizeMode('contain')} 
                  className={`px-4 py-1.5 rounded text-xs ${resizeMode === 'contain' ? 'bg-primary text-black' : 'bg-white/10 text-white'}`}
                >
                  Fit
                </button>
                <button 
                  onClick={() => setResizeMode('cover')} 
                  className={`px-4 py-1.5 rounded text-xs ${resizeMode === 'cover' ? 'bg-primary text-black' : 'bg-white/10 text-white'}`}
                >
                  Zoom
                </button>
              </div>
            </div>
            <div className="mt-4 border-t border-white/5 pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-xs uppercase mb-1 flex items-center gap-2">
                    <i className="fa-solid fa-circle-play text-primary"></i> Auto-Play Next
                  </p>
                  <p className="text-[10px] text-gray-500">
                    Automatically play the next episode at 95% completion
                  </p>
                </div>
                <button
                  onClick={() => {
                    const newVal = !autoPlayNext;
                    setAutoPlayNext(newVal);
                    localStorage.setItem('slflix_autoplay_next', newVal ? 'true' : 'false');
                  }}
                  className={`w-12 h-6 rounded-full p-0.5 transition-colors duration-200 focus:outline-none flex items-center cursor-pointer ${autoPlayNext ? 'bg-primary justify-end' : 'bg-gray-600 justify-start'}`}
                >
                  <div
                    className="bg-white w-5 h-5 rounded-full shadow-md transform transition-all duration-200"
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <div 
        className={`absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/80 transition-opacity flex flex-col justify-between z-30 ${showControls && !locked && !showSettings && !showSourceSelect && !showAudioSubtitleModal ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onMouseEnter={() => { isHoveringControlsRef.current = true; }}
        onMouseLeave={() => { isHoveringControlsRef.current = false; }}
      >
        <div 
          className="p-4 flex justify-between items-start pointer-events-auto"
          onMouseEnter={() => { isHoveringControlsRef.current = true; }}
          onMouseLeave={() => { isHoveringControlsRef.current = false; }}
        >
          <div className="flex items-center gap-3">
            <button 
              onClick={onClose} 
              className="w-9 h-9 flex items-center justify-center text-white hover:bg-white/10 rounded-full transition-colors"
            >
              <i className="fa-solid fa-arrow-left"></i>
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-white font-bold text-sm truncate max-w-[200px]">{title}</h2>
                {watchPartyProps && (
                  <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-md px-2.5 py-0.5 rounded-full border border-primary/30 text-[11px] font-bold text-white">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <i className="fa-solid fa-eye text-primary text-[10px]"></i>
                    <span>{watchPartyProps.viewersCount}</span>
                    {watchPartyProps.isHost ? (
                      <span className="text-[9px] bg-amber-500/30 text-amber-300 px-1.5 py-0.2 rounded font-black ml-1 flex items-center gap-1">
                        <i className="fa-solid fa-crown text-[9px] text-amber-300"></i>
                        <span>HOST</span>
                      </span>
                    ) : (
                      <span className="text-[9px] bg-cyan-500/30 text-cyan-300 px-1.5 py-0.2 rounded font-black ml-1">
                        VIEWER
                      </span>
                    )}
                  </div>
                )}
              </div>
              {subTitle && <p className="text-gray-400 text-xs">{subTitle}</p>}
            </div>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => {
                const url = window.location.href;
                const text = `Check out ${title} on SL-FLIX! Watch free HD online: ${url}`;
                window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
              }}
              className="w-9 h-9 flex items-center justify-center text-white hover:bg-[#25D366] rounded-full bg-white/10 transition-colors"
              title="Share on WhatsApp"
            >
              <i className="fa-brands fa-whatsapp"></i>
            </button>
            {isSeries && movie && (
              <>
                <VideoPlayerBulkModalWrapper movieId={movie.subjectId || movie.detailPath || ''} seasonNumber={currentSeason} />
                <button 
                  onClick={() => setShowSettings(true)} 
                  className="w-9 h-9 flex items-center justify-center text-white hover:bg-white/10 rounded-full bg-white/10"
                  title="Episodes"
                >
                  <i className="fa-solid fa-list-ul"></i>
                </button>
              </>
            )}
            <button 
              onClick={() => setShowSourceSelect(true)} 
              className="w-9 h-9 flex items-center justify-center text-white hover:bg-white/10 rounded-full bg-white/10"
              title="Quality"
            >
              <i className="fa-solid fa-list"></i>
            </button>
            <button 
              onClick={() => setShowSettings(!showSettings)} 
              className={`w-9 h-9 flex items-center justify-center rounded-full ${showSettings ? 'bg-primary text-black' : 'text-white hover:bg-white/10'}`}
              title="Settings"
            >
              <i className="fa-solid fa-gear"></i>
            </button>
          </div>
        </div>
        <div className={`absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity duration-300 ${playing && !isBuffering ? 'opacity-0' : 'opacity-100'}`}>
          <button 
            onClick={togglePlay} 
            className="pointer-events-auto w-14 h-14 md:w-20 md:h-20 bg-white/90 hover:bg-white rounded-full flex items-center justify-center text-black shadow-lg hover:scale-110 transition-all animate-pulse"
          >
            <i className={`fa-solid ${playing ? 'fa-pause' : 'fa-play'} text-2xl md:text-3xl ml-1`}></i>
          </button>
        </div>
        {!minimized && (
          <div 
            className="p-4 space-y-3 pointer-events-auto"
            onMouseEnter={() => { isHoveringControlsRef.current = true; }}
            onMouseLeave={() => { isHoveringControlsRef.current = false; }}
          >
            {!isLive && (
              <div 
                className="relative w-full h-8 flex items-center group cursor-pointer"
                onMouseMove={handleSeekMouseMove}
                onMouseEnter={() => setIsHoveringSeek(true)}
                onMouseLeave={() => setIsHoveringSeek(false)}
              >
                {/* Floating Seekbar Time Indicator Badge */}
                {isHoveringSeek && duration > 0 && (
                  <div 
                    className="absolute bottom-9 pointer-events-none z-50 flex flex-col items-center -translate-x-1/2 transition-all duration-75"
                    style={{ left: `clamp(45px, ${hoverSeekPercent}%, calc(100% - 45px))` }}
                  >
                    <div className="px-3 py-1.5 bg-black/90 backdrop-blur-md rounded-lg border border-primary/40 shadow-2xl flex items-center gap-1.5">
                      <i className="fa-regular fa-clock text-primary text-[10px]"></i>
                      <span className="text-xs font-mono font-bold text-white tracking-wider">
                        {formatTime(hoverSeekTime)}
                      </span>
                    </div>
                    <div className="w-2 h-2 bg-black rotate-45 border-r border-b border-primary/40 -mt-1 shadow" />
                  </div>
                )}

                <div className="absolute w-full h-1.5 bg-white/20 rounded-full overflow-hidden">
                  <div 
                    className="absolute h-full bg-white/40 rounded-full" 
                    style={{ width: `${bufferedPercent}%` }}
                  />
                  <div 
                    className="absolute h-full bg-primary rounded-full" 
                    style={{ width: `${playedPercent}%` }}
                  />
                </div>
                <input
                  type="range"
                  min="0"
                  max={duration || 0}
                  step="0.1"
                  value={currentTime}
                  onChange={handleSeek}
                  onMouseDown={handleSeekStart}
                  onMouseUp={handleSeekEnd}
                  onTouchStart={handleSeekStart}
                  onTouchEnd={handleSeekEnd}
                  className="absolute w-full h-1.5 appearance-none bg-transparent cursor-pointer z-10 outline-none
                    [&::-webkit-slider-thumb]:appearance-none 
                    [&::-webkit-slider-thumb]:w-5 
                    [&::-webkit-slider-thumb]:h-5 
                    [&::-webkit-slider-thumb]:rounded-full 
                    [&::-webkit-slider-thumb]:bg-primary 
                    [&::-webkit-slider-thumb]:border-2 
                    [&::-webkit-slider-thumb]:border-white 
                    [&::-webkit-slider-thumb]:shadow-[0_0_15px_rgba(0,229,255,0.9)] 
                    [&::-webkit-slider-thumb]:scale-100 
                    [&::-webkit-slider-thumb]:transition-transform"
                />
              </div>
            )}
            <div className="flex justify-between items-center text-white text-xs">
              <div className="flex items-center gap-3">
                <button onClick={togglePlay}>
                  <i className={`fa-solid ${playing ? 'fa-pause' : 'fa-play'}`}></i>
                </button>
                {!isLive && (
                  <>
                    <button onClick={() => skip(-10)}><i className="fa-solid fa-rotate-left"></i></button>
                    <button onClick={() => skip(10)}><i className="fa-solid fa-rotate-right"></i></button>
                    <span className="font-mono">{formatTime(currentTime)} / {formatTime(duration)}</span>
                  </>
                )}
                {isLive && <span className="text-red-500 font-bold">LIVE</span>}
              </div>
              <div className="flex items-center gap-2 md:gap-3">
                {/* Quick CC Subtitles Toggle Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSubtitles();
                  }}
                  className={`w-7 h-7 md:w-8 md:h-8 rounded-lg flex items-center justify-center transition-all ${
                    activeSubtitle >= 0 
                      ? 'bg-primary text-black font-extrabold shadow-md shadow-primary/30' 
                      : 'text-gray-400 hover:text-white hover:bg-white/10'
                  }`}
                  title="Toggle Subtitles (C)"
                >
                  <span className="text-[11px] font-black tracking-tighter">CC</span>
                </button>

                {/* Audio & Subtitles Selector Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAudioSubtitleModal(true);
                  }}
                  className={`px-2.5 py-1 rounded-lg flex items-center gap-1.5 text-xs font-bold transition-all ${
                    activeSubtitle >= 0 || activeAudioTrack >= 0
                      ? 'bg-white/15 text-white hover:bg-white/20' 
                      : 'text-gray-400 hover:text-white hover:bg-white/10'
                  }`}
                  title="Audio & Subtitles"
                >
                  <i className="fa-solid fa-sliders text-xs"></i>
                  <span className="hidden sm:inline">Audio & Subs</span>
                </button>

                <div className="relative flex items-center gap-2 group/vol">
                  <button onClick={toggleMute} className="hover:text-primary">
                    <i className={`fa-solid ${isMuted ? 'fa-volume-xmark' : volume > 0.5 ? 'fa-volume-high' : 'fa-volume-low'}`}></i>
                  </button>
                  <div className="w-0 overflow-hidden group-hover/vol:w-20 transition-all duration-200">
                    <input 
                      type="range" 
                      min="0" 
                      max="1" 
                      step="0.1" 
                      value={isMuted ? 0 : volume}
                      onChange={(e) => { setVolume(parseFloat(e.target.value)); if (isMuted) setIsMuted(false); }}
                      className="w-16 h-1 accent-primary cursor-pointer"
                    />
                  </div>
                </div>
                <button 
                  onClick={cycleSpeed} 
                  className="font-bold hover:text-primary"
                >
                  {playbackSpeed}x
                </button>
                <button 
                  onClick={toggleLandscape} 
                  className={`hover:text-primary transition-colors ${isForcedLandscape ? 'text-primary' : 'text-white/80'}`} 
                  title="Toggle Landscape / Rotate Screen"
                >
                  <i className="fa-solid fa-mobile-screen-button -rotate-90"></i>
                </button>
                <button onClick={toggleFullscreen} className="hover:text-primary" title="Fullscreen (F)">
                  <i className="fa-solid fa-expand"></i>
                </button>
                <button onClick={togglePiP} className="hover:text-primary" title="Picture in Picture / Mini Player">
                  <i className="fa-solid fa-clone"></i>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {networkState === 'unstable' && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[100] bg-black/80 text-white px-4 py-2 rounded-full text-xs font-bold flex items-center gap-2 shadow-lg animate-fade-in-down">
          <i className="fa-solid fa-wifi text-yellow-500"></i> Network Unstable
        </div>
      )}
      {networkState === 'offline' && isBuffering && (
        <div className="absolute inset-0 z-[100] bg-black/80 flex flex-col items-center justify-center animate-fade-in">
          <i className="fa-solid fa-wifi text-red-500 text-6xl mb-4 animate-pulse"></i>
          <h2 className="text-white text-xl font-bold mb-2">Network Disconnected</h2>
          <p className="text-gray-400 text-sm">Please check your internet connection.</p>
        </div>
      )}
      {showReconnected && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[100] bg-emerald-500/90 text-white px-4 py-2 rounded-full text-xs font-bold flex items-center gap-2 shadow-lg animate-fade-in-down">
          <i className="fa-solid fa-check-circle"></i> Connected. Resuming playback...
        </div>
      )}
      {showNextCountdown && (
        <div className="absolute inset-0 z-[100] bg-black/80 flex flex-col items-center justify-center animate-fade-in">
          <h2 className="text-white text-2xl font-bold mb-4">Next Episode</h2>
          <div className="relative w-24 h-24 flex items-center justify-center mb-6">
            <svg className="absolute inset-0 w-full h-full transform -rotate-90">
              <circle cx="48" cy="48" r="45" stroke="rgba(255,255,255,0.2)" strokeWidth="6" fill="none" />
              <circle 
                cx="48" cy="48" r="45" 
                stroke="#00E5FF" 
                strokeWidth="6" 
                fill="none" 
                strokeDasharray="283" 
                strokeDashoffset={283 - (283 * countdown) / 5} 
                className="transition-all duration-1000 ease-linear"
              />
            </svg>
            <span className="text-white text-3xl font-bold">{countdown}</span>
          </div>
          <div className="flex gap-4">
            <button 
              onClick={() => {
                setShowNextCountdown(false);
                onPlayNext?.();
              }}
              className="bg-primary text-black px-6 py-2 rounded-full font-bold hover:bg-primary/80 transition-colors"
            >
              Play Now
            </button>
            <button 
              onClick={() => {
                setShowNextCountdown(false);
                onClose();
              }}
              className="bg-white/20 text-white px-6 py-2 rounded-full font-bold hover:bg-white/30 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {locked && (
        <div className="absolute inset-0 z-[90] bg-black/80 flex items-center justify-center">
          <button 
            onClick={() => setLocked(false)} 
            className="w-14 h-14 bg-white/10 rounded-full text-white"
          >
            <i className="fa-solid fa-lock"></i>
          </button>
        </div>
      )}

      {/* Watch Party Floating In-Stream Chat Overlay */}
      {watchPartyProps?.inStreamChat && (
        <div className="absolute top-20 left-4 z-40 max-w-xs md:max-w-sm bg-black/85 backdrop-blur-md border border-primary/40 rounded-2xl p-3 shadow-2xl animate-fade-in flex items-start gap-3 pointer-events-auto">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary to-blue-500 flex items-center justify-center text-xs font-bold text-black shrink-0 shadow-md">
            {watchPartyProps.inStreamChat.username.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-primary truncate">{watchPartyProps.inStreamChat.username}</span>
              <span className="text-[10px] text-white/50">Party Chat</span>
            </div>
            <p className="text-xs text-white/90 break-words mt-0.5 line-clamp-2">{watchPartyProps.inStreamChat.message}</p>
          </div>
        </div>
      )}

      {/* Watch Party Pause Notice */}
      {watchPartyProps?.pauseNotice && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 bg-black/90 backdrop-blur-md border border-amber-500/50 text-amber-300 px-4 py-2 rounded-full text-xs font-bold shadow-2xl flex items-center gap-2 animate-bounce pointer-events-none">
          <i className="fa-solid fa-circle-info text-amber-400"></i>
          <span>{watchPartyProps.pauseNotice}</span>
        </div>
      )}

      <div className="absolute bottom-16 md:bottom-20 left-4 z-40 pointer-events-none select-none">
        <div className="px-3 py-1.5 bg-black/60 backdrop-blur-md rounded opacity-60 hover:opacity-80 transition-opacity">
          <span className="text-white text-xs font-bold tracking-wider">
            SL<span className="text-primary">FLIX</span>
          </span>
        </div>
      </div>

      {showAudioSubtitleModal && (
        <AudioSubtitleModal
          isOpen={showAudioSubtitleModal}
          onClose={() => setShowAudioSubtitleModal(false)}
          audioTracks={audioTracks}
          activeAudioTrack={activeAudioTrack}
          onAudioTrackChange={handleAudioTrackChange}
          subtitles={subtitles}
          activeSubtitle={activeSubtitle}
          onSubtitleChange={(index: number) => {
            setActiveSubtitle(index);
            if (index >= 0) {
              const name = subtitles[index]?.name || 'Subtitles';
              showHudToast(`Subtitles: ${name}`, 'fa-solid fa-closed-captioning');
            } else {
              showHudToast('Subtitles Off', 'fa-solid fa-closed-captioning');
            }
          }}
          subtitleOffset={subtitleOffset}
          onSubtitleOffsetChange={setSubtitleOffset}
          subtitleFontSize={subtitleFontSize}
          onSubtitleFontSizeChange={setSubtitleFontSize}
        />
      )}
    </div>
  );
};
const VideoPlayer = (props: VideoPlayerProps) => {
  if (props.isTrailer) {
    return <TrailerPlayer 
      title={props.title} 
      sources={props.sources} 
      onClose={props.onClose} 
      coverImage={props.sources?.[0]?.stream} 
    />;
  }
  return <StreamingPlayer {...props} />;
};
export default VideoPlayer;