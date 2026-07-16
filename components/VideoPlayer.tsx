import React, { useEffect, useRef, useState, useCallback } from 'react';
import { VideoSource, Subtitle, Season, MovieResult } from '../types';
import Hls from 'hls.js';
import SubtitleManager, { detectUserLanguage, findBestSubtitle } from './SubtitleManager';
import SeasonSelector from './SeasonSelector';
import BulkDownloadModal from './BulkDownloadModal';
import VideoPlayerBulkModalWrapper from './VideoPlayerBulkModalWrapper';

interface VideoPlayerProps {
  title: string;
  subTitle?: string;
  sources: VideoSource[];
  subtitles?: Subtitle[];
  onClose: () => void;
  minimized?: boolean;
  overlay?: boolean;
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
  
  let vtt = 'WEBVTT\n\n';
  const lines = srtContent.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;
    
    if (line.includes('-->')) {
      line = line.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/, '$1.$2');
      line = line.replace(/,/g, '.');
      vtt += line + '\n';
    } else if (!isNaN(Number(line)) && line.includes('\n')) {
      continue;
    } else {
      line = line
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/"/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'");
      vtt += line + '\n';
    }
  }
  
  return vtt;
};

const vttBlobCache = new Map<string, string>();

const convertSrtUrlToVttBlob = async (srtUrl: string): Promise<string> => {
  if (vttBlobCache.has(srtUrl)) {
    return vttBlobCache.get(srtUrl)!;
  }
  
  try {
    let response;
    try {
      response = await fetch(srtUrl, {
        headers: {
          'Referer': 'https://123movienow.cc/',
          'Origin': 'https://123movienow.cc'
        }
      });
    } catch (e) {
      response = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(srtUrl)}`);
    }
    
    if (!response || !response.ok) {
      return srtUrl;
    }
    
    const srtContent = await response.text();
    
    if (!srtContent.includes('-->')) {
      return srtUrl;
    }
    
    const vttContent = convertSrtToVtt(srtContent);
    const blob = new Blob([vttContent], { type: 'text/vtt' });
    const blobUrl = URL.createObjectURL(blob);
    
    vttBlobCache.set(srtUrl, blobUrl);
    return blobUrl;
  } catch (error) {
    return srtUrl;
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
              src={`https://www.youtube.com/embed/${getYoutubeId(trailerUrl)}?autoplay=1&rel=0`} 
              className="w-full h-full" 
              allowFullScreen 
              title={title} 
            />
          ) : (
            <video 
              src={trailerUrl} 
              controls 
              autoPlay 
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
  onToggleMinimize,
  initialTime = 0, 
  onProgressUpdate, 
  nextEpisode, 
  onPlayNext, 
  isLive = false,
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
  const [convertedSubUrls, setConvertedSubUrls] = useState<Record<number, string>>({});
  const [isConvertingSubs, setIsConvertingSubs] = useState(false);
  
  const [networkState, setNetworkState] = useState<'good' | 'unstable' | 'offline'>('good');
  const [showNextCountdown, setShowNextCountdown] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [showReconnected, setShowReconnected] = useState(false);
  const [autoPlayNext, setAutoPlayNext] = useState(() => {
    return localStorage.getItem('slflix_autoplay_next') !== 'false';
  });
  const hasTriggeredAutoPlayRef = useRef(false);

  const attemptPlay = useCallback(() => { 
    const video = videoRef.current; 
    if (!video) return; 
    video.play().catch(() => setPlaying(false)); 
  }, []);

  useEffect(() => {
    const handleOffline = () => setNetworkState('offline');
    const handleOnline = () => {
      setNetworkState('good');
      setShowReconnected(true);
      setTimeout(() => setShowReconnected(false), 3000);
      if (hlsRef.current) hlsRef.current.startLoad();
      if (videoRef.current && !playing) attemptPlay();
    };
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (minimized || locked) return;
      
      switch(e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowRight':
          skip(10);
          break;
        case 'ArrowLeft':
          skip(-10);
          break;
        case 'f':
          toggleFullscreen();
          break;
        case 'm':
          toggleMute();
          break;
        case 'ArrowUp':
          adjustVolume(0.1);
          break;
        case 'ArrowDown':
          adjustVolume(-0.1);
          break;
        case 'Escape':
          if (showSeasonSelector) setShowSeasonSelector(false);
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
  }, [playing, minimized, locked, showSettings, showSourceSelect, showSeasonSelector]);

  useEffect(() => {
    if (subtitles.length > 0 && activeSubtitle === -1) {
      const bestSubtitle = findBestSubtitle(subtitles);
      if (bestSubtitle >= 0) {
        setActiveSubtitle(bestSubtitle);
      }
    }
  }, [subtitles]);

  const toggleFullscreen = useCallback(() => {
    if (locked) return;
    if (!document.fullscreenElement && containerRef.current) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, [locked]);

  const updateBuffered = useCallback(() => {
    const video = videoRef.current;
    if (video && video.buffered.length > 0) {
      const bufferedEnd = video.buffered.end(video.buffered.length - 1);
      setBuffered(bufferedEnd);
    }
  }, []);

  const loadSource = useCallback((source: VideoSource, sourceIndex: number) => {
    const video = videoRef.current;
    if (!video) return;
    
    setIsBuffering(true);
    setVideoError(null);
    setActiveSourceIndex(sourceIndex);
    
    if (source.quality) {
      const qStr = String(source.quality);
      setPreferredQuality(qStr);
      localStorage.setItem('slflix_preferred_quality', qStr);
    }
    
    if (hlsRef.current) { 
      hlsRef.current.destroy(); 
      hlsRef.current = null; 
    }
    
    const url = source.stream || source.direct || source.download;
    if (!url) return;

    const isHlsStream = source.type === 'hls' || url.includes('.m3u8');
    
    if (isHlsStream && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
    } else if (Hls.isSupported() && isHlsStream) {
      const hls = new Hls({
        capLevelToPlayerSize: true,
        autoStartLoad: true,
        debug: false
      });
      
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(video);
      
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsBuffering(false);
        if (initialTime > 0) video.currentTime = initialTime;
        video.playbackRate = playbackSpeed;
        attemptPlay();
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
            hls.destroy();
            setVideoError('Fatal playback error. Please try another source.');
          }
        }
      });
      
      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
      });
    } else {
      video.src = url;
      
      video.onloadstart = () => {
        setIsBuffering(true);
      };
      
      video.oncanplay = () => { 
        setIsBuffering(false); 
        attemptPlay(); 
      };
      
      video.onplaying = () => {
        setIsBuffering(false);
        setPlaying(true);
      };
      
      video.onwaiting = () => {
        setIsBuffering(true);
      };
      
      video.onerror = (e) => {
        setVideoError('Failed to load video. Please try another source.');
        setIsBuffering(false);
      };
      
      if (initialTime > 0) video.currentTime = initialTime;
      video.playbackRate = playbackSpeed;
      video.onprogress = () => updateBuffered();
    }
  }, [initialTime, playbackSpeed, subtitles, attemptPlay, updateBuffered]);

  useEffect(() => { 
    hasTriggeredAutoPlayRef.current = false;
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
    return () => { 
      if (hlsRef.current) { 
        hlsRef.current.destroy(); 
        hlsRef.current = null; 
      } 
    }; 
  }, [sources]);

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

  const handleMouseMove = useCallback(() => {
    if (minimized) return;
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (!locked && playing) {
      controlsTimeoutRef.current = setTimeout(() => { 
        if (!showSettings && !showSourceSelect && !showSeasonSelector) setShowControls(false); 
      }, 3000);
    }
  }, [minimized, locked, playing, showSettings, showSourceSelect, showSeasonSelector]);

  const togglePlay = useCallback(() => { 
    if (locked) return; 
    if (videoRef.current) {
      videoRef.current.paused ? attemptPlay() : videoRef.current.pause(); 
    }
  }, [locked, attemptPlay]);
  
  const skip = useCallback((seconds: number) => { 
    if (videoRef.current && !locked && !isBuffering && !isLive) {
      const newTime = videoRef.current.currentTime + seconds;
      videoRef.current.currentTime = Math.max(0, Math.min(newTime, duration || Infinity));
    } 
  }, [locked, isBuffering, isLive, duration]);
  
  const cycleSpeed = useCallback(() => { 
    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const currentIndex = speeds.indexOf(playbackSpeed);
    const nextIndex = (currentIndex + 1) % speeds.length;
    setPlaybackSpeed(speeds[nextIndex]);
  }, [playbackSpeed]);
  
  const handleDownload = useCallback((source: VideoSource) => { 
    const link = source.download || source.direct || source.stream; 
    if (link) window.open(link, '_blank'); 
  }, []);
  
  const toggleMute = useCallback(() => setIsMuted(!isMuted), [isMuted]);
  
  const adjustVolume = useCallback((delta: number) => {
    const newVol = Math.max(0, Math.min(1, volume + delta));
    setVolume(newVol);
    if (newVol > 0 && isMuted) setIsMuted(false);
  }, [volume, isMuted]);
  
  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || !duration || locked) return;
    const rect = progressRef.current.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    const newTime = pos * duration;
    if (videoRef.current) videoRef.current.currentTime = newTime;
  }, [duration, locked]);

  const handleSeasonChange = useCallback((season: number) => {
    onSeasonChange?.(season);
  }, [onSeasonChange]);

  const handleEpisodeSelect = useCallback((season: number, episode: number) => {
    onEpisodeChange?.(season, episode);
    setShowSeasonSelector(false);
  }, [onEpisodeChange]);

  const bufferedPercent = duration > 0 ? (buffered / duration) * 100 : 0;
  const playedPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  const isSeries = movie?.type?.includes('Series') || movie?.type?.includes('TV') || (movie?.seasons && movie.seasons.length > 0);

  return (
    <div 
      ref={containerRef} 
      className={minimized 
        ? "fixed bottom-4 right-4 w-[320px] aspect-video z-[2000] bg-black shadow-2xl rounded-xl overflow-hidden cursor-pointer" 
        : "fixed inset-0 z-[2000] bg-black group overflow-hidden"
      } 
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
          const curr = e.currentTarget.currentTime;
          const dur = e.currentTarget.duration;
          setCurrentTime(curr); 
          updateBuffered(); 
          if (onProgressUpdate && duration > 0) onProgressUpdate(curr, duration); 

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
          setVideoError('Failed to load video. Please try another source.');
          setIsBuffering(false);
        }}
      >
      </video>

      {isBuffering && networkState !== 'offline' && (
        <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/80">
          <FastStreamLoader buffered={bufferedPercent / 100} />
        </div>
      )}

      {videoError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-40">
          <div className="text-center p-4">
            <div className="text-red-500 text-lg mb-2">⚠️</div>
            <p className="text-white">{videoError}</p>
            <button 
              onClick={() => setVideoError(null)}
              className="mt-4 px-4 py-2 bg-primary text-black rounded-lg"
            >
              Try Again
            </button>
          </div>
        </div>
      )}

      {showSourceSelect && (
        <div 
          className="absolute inset-0 z-[80] bg-black/90 flex items-center justify-center p-4" 
          onClick={() => setShowSourceSelect(false)}
        >
          <div 
            className="bg-[#1a1a2e] rounded-xl p-4 w-full max-w-sm" 
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-white font-bold">Select Quality</h3>
              <button 
                onClick={() => setShowSourceSelect(false)} 
                className="text-gray-400 hover:text-white"
              >
                <i className="fa-solid fa-times"></i>
              </button>
            </div>
            <div className="space-y-2">
              {sources.map((s, i) => (
                <div key={i} className="flex gap-2">
                  <button 
                    onClick={() => { loadSource(s, i); setShowSourceSelect(false); }} 
                    className={`flex-1 p-3 rounded-lg text-left flex justify-between ${activeSourceIndex === i ? 'bg-primary text-black' : 'bg-white/10 text-white'}`}
                  >
                    <span className="font-bold">{s.label || s.quality + 'p'}</span>
                    {s.type === 'hls' && <span className="text-xs opacity-70">HLS</span>}
                  </button>
                  <button 
                    onClick={() => handleDownload(s)} 
                    className="p-3 bg-white/10 hover:bg-green-500/30 text-white rounded-lg"
                  >
                    <i className="fa-solid fa-download"></i>
                  </button>
                </div>
              ))}
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

      <div className={`absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/80 transition-opacity flex flex-col justify-between ${showControls && !locked && !showSettings && !showSourceSelect ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="p-4 flex justify-between items-start">
          <div className="flex items-center gap-3">
            <button 
              onClick={onClose} 
              className="w-9 h-9 flex items-center justify-center text-white hover:bg-white/10 rounded-full transition-colors"
            >
              <i className="fa-solid fa-arrow-left"></i>
            </button>
            <div>
              <h2 className="text-white font-bold text-sm truncate max-w-[200px]">{title}</h2>
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
          <div className="p-4 space-y-3">
            {!isLive && (
              <div 
                ref={progressRef} 
                onClick={handleProgressClick} 
                className="relative h-1.5 bg-white/20 rounded-full cursor-pointer group"
              >
                <div 
                  className="absolute h-full bg-white/40 rounded-full transition-all" 
                  style={{ width: `${bufferedPercent}%` }}
                />
                <div 
                  className="absolute h-full bg-white rounded-full transition-all" 
                  style={{ width: `${playedPercent}%` }}
                />
                {isBuffering && (
                  <div 
                    className="absolute h-full bg-primary animate-pulse rounded-full" 
                    style={{ width: `${Math.min(bufferedPercent - playedPercent, 20)}%` }}
                  />
                )}
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
              
              <div className="flex items-center gap-3">
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
                
                <button onClick={toggleFullscreen} className="hover:text-primary">
                  <i className="fa-solid fa-expand"></i>
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
      
      <div className="absolute bottom-16 md:bottom-20 left-4 z-40 pointer-events-none select-none">
        <div className="px-3 py-1.5 bg-black/60 backdrop-blur-md rounded opacity-60 hover:opacity-80 transition-opacity">
          <span className="text-white text-xs font-bold tracking-wider">
            SL<span className="text-primary">FLIX</span>
          </span>
        </div>
      </div>
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
