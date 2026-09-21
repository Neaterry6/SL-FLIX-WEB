import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Hls from 'hls.js';
import SubtitleManager, { findBestSubtitle } from '../SubtitleManager';
import SeasonSelector from '../SeasonSelector';
import { RetroTvError } from '../RetroTvError';
import { fetchAndParseSrt, SrtCue } from '../../utils/srtParser';
import { AudioSubtitleModal, AudioTrackItem } from '../AudioSubtitleModal';
import { 
  CaptionSettings, 
  getStoredCaptionSettings, 
  getCaptionFontFamilyCss, 
  getCaptionBgCss, 
  getCaptionTextShadowCss 
} from '../../utils/captionSettings';
import { VideoPlayerProps, WatchPartyProps } from './VideoPlayerTypes';
import { formatTime, convertSrtUrlToVttBlob } from './utils';
import { FastStreamLoader } from './FastStreamLoader';
import { VideoHud } from './VideoHud';
import { VideoSource } from '../../types';

export const StreamingPlayer: React.FC<VideoPlayerProps> = ({ 
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
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [resizeMode, setResizeMode] = useState<'contain' | 'cover'>('contain');
  const [activeSourceIndex, setActiveSourceIndex] = useState(0);
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
  const [needsUserGesture, setNeedsUserGesture] = useState(false);
  const hasTriggeredAutoPlayRef = useRef(false);
  const savedTimeRef = useRef<number>(initialTime || 0);
  const [isDragging, setIsDragging] = useState(false);
  const wantsToPlayRef = useRef(true);

  // Subtitle Overlay Engine
  const [activeCues, setActiveCues] = useState<SrtCue[]>([]);
  const [activeSubtitleCue, setActiveSubtitleCue] = useState<string | null>(null);
  const [subtitleOffset, setSubtitleOffset] = useState<number>(0);
  const [subtitleFontSize, setSubtitleFontSize] = useState<'small' | 'medium' | 'large'>('medium');
  const [showAudioSubtitleModal, setShowAudioSubtitleModal] = useState(false);
  const [captionSettings, setCaptionSettings] = useState<CaptionSettings>(getStoredCaptionSettings);

  // Audio Tracks
  const [audioTracks, setAudioTracks] = useState<AudioTrackItem[]>([]);
  const [activeAudioTrack, setActiveAudioTrack] = useState<number>(-1);

  // Seekbar Preview
  const [isHoveringSeek, setIsHoveringSeek] = useState(false);
  const [hoverSeekPercent, setHoverSeekPercent] = useState(0);
  const [hoverSeekTime, setHoverSeekTime] = useState(0);
  const [isForcedLandscape, setIsForcedLandscape] = useState(false);

  // HUD Toast
  const [hudToast, setHudToast] = useState<{ message: string; icon?: string } | null>(null);
  const hudToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoveringControlsRef = useRef(false);

  const showHudToast = useCallback((message: string, icon?: string) => {
    setHudToast({ message, icon });
    if (hudToastTimerRef.current) clearTimeout(hudToastTimerRef.current);
    hudToastTimerRef.current = setTimeout(() => setHudToast(null), 1400);
  }, []);

  const attemptPlay = useCallback(() => { 
    const video = videoRef.current; 
    if (!video || !wantsToPlayRef.current) return; 
    video.play().catch((error) => {
      if (error.name === 'NotAllowedError') {
        setNeedsUserGesture(true);
      }
      setPlaying(false);
    });
  }, []);

  // SRT Direct Overlay Engine
  useEffect(() => {
    if (subtitles.length === 0 || activeSubtitle < 0) {
      setActiveCues([]);
      setActiveSubtitleCue(null);
      return;
    }
    const sub = subtitles[activeSubtitle];
    if (!sub || !sub.url) return;

    let isMounted = true;
    fetchAndParseSrt(sub.url).then((cues: SrtCue[]) => {
      if (isMounted) setActiveCues(cues);
    }).catch((err: Error) => console.warn('[StreamingPlayer] SRT parse failed:', err));

    return () => { isMounted = false; };
  }, [activeSubtitle, subtitles]);

  useEffect(() => {
    if (activeSubtitle < 0 || activeCues.length === 0) {
      if (activeSubtitleCue !== null) setActiveSubtitleCue(null);
      return;
    }
    const effectiveTime = currentTime + subtitleOffset;
    const cue = activeCues.find(c => effectiveTime >= c.start && effectiveTime <= c.end);
    const text = cue ? cue.text : null;
    if (text !== activeSubtitleCue) setActiveSubtitleCue(text);
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
      if (!navigator.onLine) setNetworkState('offline');
      else if (conn) {
        if (conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g' || conn.downlink < 0.8) setNetworkState('unstable');
        else setNetworkState('good');
      }
    };

    checkConnection();
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    if (conn) conn.addEventListener('change', checkConnection);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      if (conn) conn.removeEventListener('change', checkConnection);
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
          if (vttUrl !== sub.url) setConvertedSubUrls(prev => ({ ...prev, [activeSubtitle]: vttUrl }));
        } catch (e) {}
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
    const video = videoRef.current;
    if (video) {
      const willPlay = video.paused;
      if (willPlay) {
        wantsToPlayRef.current = true;
        attemptPlay();
      } else {
        wantsToPlayRef.current = false;
        video.pause();
      }
      if (watchPartyProps?.onHostAction) {
        watchPartyProps.onHostAction(willPlay ? 'play' : 'pause', video.currentTime || 0);
      }
    }
  }, [locked, attemptPlay, watchPartyProps]);

  const skip = useCallback((seconds: number) => { 
    const video = videoRef.current;
    if (video && !locked && !isLive) {
      const newTime = Math.max(0, Math.min(video.currentTime + seconds, duration || Infinity));
      video.currentTime = newTime;
      setCurrentTime(newTime);
      if (watchPartyProps?.onHostAction) {
        watchPartyProps.onHostAction('seek', newTime);
      }
    } 
  }, [locked, isLive, duration, watchPartyProps]);

  useEffect(() => {
    if (!watchPartyProps) return;
    const video = videoRef.current;
    if (!video) return;

    if (watchPartyProps.syncPaused !== undefined) {
      if (watchPartyProps.syncPaused) {
        wantsToPlayRef.current = false;
        if (!video.paused) video.pause();
        setPlaying(false);
        setIsBuffering(false);
      } else {
        wantsToPlayRef.current = true;
        if (video.paused) attemptPlay();
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

  const handleMouseMove = useCallback(() => resetControlsTimeout(), [resetControlsTimeout]);

  const initHls = useCallback(() => {
    if (!hlsRef.current && Hls.isSupported()) {
      const hls = new Hls({
        capLevelToPlayerSize: true,
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        maxBufferSize: 120 * 1024 * 1024,
        backBufferLength: 60,
        enableWorker: true,
        fragLoadingMaxRetry: 10,
        maxBufferHole: 0.3,
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.1,
        nudgeMaxRetry: 8,
      });
      hlsRef.current = hls;

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsBuffering(false);
        if (hls.audioTracks && hls.audioTracks.length > 0) {
          setAudioTracks(hls.audioTracks.map((t, idx) => ({ id: idx, name: t.name || `Audio ${idx+1}`, lang: t.lang })));
          setActiveAudioTrack(hls.audioTrack);
        }
        if (videoRef.current) {
          if (savedTimeRef.current > 0) videoRef.current.currentTime = savedTimeRef.current;
          videoRef.current.playbackRate = playbackSpeed;
          if (wantsToPlayRef.current) attemptPlay();
        }
      });
      
      hls.on(Hls.Events.ERROR, (_, data) => { 
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else setVideoError('Fatal playback error. Please try another source.');
        }
      });
    }
    const hls = hlsRef.current;
    if (hls && videoRef.current && hls.media !== videoRef.current) hls.attachMedia(videoRef.current);
    return hls;
  }, [playbackSpeed, attemptPlay]);

  const loadSource = useCallback((source: VideoSource, sourceIndex: number) => {
    const video = videoRef.current;
    if (!video) return;
    
    setIsBuffering(true);
    setVideoError(null);
    setActiveSourceIndex(sourceIndex);
    
    const currentPos = (video.currentTime && video.currentTime > 0) ? video.currentTime : (currentTime > 0 ? currentTime : savedTimeRef.current);
    savedTimeRef.current = currentPos;
    wantsToPlayRef.current = true;
    
    if (source.quality) {
      setPreferredQuality(String(source.quality));
      localStorage.setItem('slflix_preferred_quality', String(source.quality));
    }
    
    const url = source.stream || source.direct || source.download;
    if (!url) return;
    
    const isHlsStream = source.type === 'hls' || url.includes('.m3u8');
    
    const restoreTimeAndPlay = () => {
      if (video) {
        if (savedTimeRef.current > 0) video.currentTime = savedTimeRef.current;
        video.playbackRate = playbackSpeed;
      }
      if (wantsToPlayRef.current) attemptPlay();
    };

    if (isHlsStream && video.canPlayType('application/vnd.apple.mpegurl')) {
      if (hlsRef.current) hlsRef.current.detachMedia();
      video.onloadedmetadata = restoreTimeAndPlay;
      video.src = url;
    } else if (Hls.isSupported() && isHlsStream) {
      const hls = initHls();
      if (hls) {
        if (video.src && !video.src.startsWith('blob:')) {
          video.removeAttribute('src');
          video.load();
        }
        hls.loadSource(url);
        hls.startLoad(savedTimeRef.current > 0 ? savedTimeRef.current : -1);
      }
    } else {
      if (hlsRef.current) hlsRef.current.detachMedia();
      video.onloadedmetadata = restoreTimeAndPlay;
      video.src = url;
    }
  }, [playbackSpeed, attemptPlay, initHls, currentTime]);

  useEffect(() => {
    if (sources.length > 0) {
      let targetIndex = 0;
      if (preferredQuality && preferredQuality !== 'Auto') {
        const index = sources.findIndex(s => String(s.quality) === preferredQuality);
        if (index !== -1) targetIndex = index;
      }
      loadSource(sources[targetIndex], targetIndex); 
    }
  }, [sources, subjectId, currentSeason, currentEpisode, isLive]);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (locked || !duration) return;
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    // Removed immediate video.currentTime set here to prevent scrambling during drag
  }, [locked, duration]);

  const handleSeekEnd = useCallback((e: any) => {
    setIsDragging(false);
    const video = videoRef.current;
    if (video && e.target) {
      const time = parseFloat(e.target.value);
      video.currentTime = time;
      savedTimeRef.current = time;
      if (wantsToPlayRef.current) attemptPlay();
      if (watchPartyProps?.onHostAction) watchPartyProps.onHostAction('seek', time);
    }
  }, [attemptPlay, watchPartyProps]);

  const isSeries = useMemo(() => {
    const rawMovieType = String(movie?.type || '').toLowerCase();
    const isExplicitMovie = rawMovieType === 'movie' || rawMovieType.includes('feature');
    return !isExplicitMovie && Boolean(
      rawMovieType.includes('series') || 
      rawMovieType.includes('tv') || 
      (movie?.seasons && movie.seasons.length > 0)
    );
  }, [movie]);

  return (
    <div 
      ref={containerRef} 
      onMouseMove={handleMouseMove}
      className={minimized 
        ? "fixed bottom-4 right-4 w-[320px] aspect-video z-[2000] bg-black shadow-2xl rounded-xl overflow-hidden" 
        : (embedded && !isFullscreen)
          ? "relative w-full aspect-video bg-black rounded-2xl overflow-hidden group shadow-2xl border border-white/10"
          : "fixed inset-0 z-[2000] bg-black group overflow-hidden"
      } 
    >
      <video
        ref={videoRef}
        className={`w-full h-full ${resizeMode === 'cover' ? 'object-cover' : 'object-contain'}`}
        onTimeUpdate={() => {
          if (!isDragging && videoRef.current) {
            setCurrentTime(videoRef.current.currentTime);
            onProgressUpdate?.(videoRef.current.currentTime, videoRef.current.duration);
          }
        }}
        onDurationChange={() => videoRef.current && setDuration(videoRef.current.duration)}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => { setIsBuffering(false); setPlaying(true); }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          if (autoPlayNext && nextEpisode) setShowNextCountdown(true);
        }}
      />
      
      {isBuffering && <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-20"><FastStreamLoader buffered={buffered / duration} /></div>}
      
      <VideoHud
        title={title}
        subTitle={subTitle}
        playing={playing}
        isBuffering={isBuffering}
        currentTime={currentTime}
        duration={duration}
        buffered={buffered}
        volume={volume}
        isMuted={isMuted}
        playbackSpeed={playbackSpeed}
        isForcedLandscape={isForcedLandscape}
        isFullscreen={isFullscreen}
        showControls={showControls}
        locked={locked}
        showSettings={showSettings}
        showSourceSelect={showSourceSelect}
        showAudioSubtitleModal={showAudioSubtitleModal}
        activeSubtitle={activeSubtitle}
        activeAudioTrack={activeAudioTrack}
        isLive={isLive}
        watchPartyProps={watchPartyProps}
        movie={movie}
        currentSeason={currentSeason}
        currentEpisode={currentEpisode}
        isSeries={isSeries}
        minimized={minimized}
        onClose={onClose}
        onTogglePlay={togglePlay}
        onSkip={skip}
        onToggleMute={() => setIsMuted(!isMuted)}
        onVolumeChange={setVolume}
        onToggleFullscreen={toggleFullscreen}
        onTogglePiP={() => {}} // simplified
        onCycleSpeed={() => {}} // simplified
        onToggleLandscape={() => setIsForcedLandscape(!isForcedLandscape)}
        onToggleSubtitles={toggleSubtitles}
        onOpenSettings={() => setShowSettings(!showSettings)}
        onOpenSourceSelect={() => setShowSourceSelect(!showSourceSelect)}
        onOpenAudioSubtitle={() => setShowAudioSubtitleModal(true)}
        onSeek={handleSeek}
        onSeekStart={() => setIsDragging(true)}
        onSeekEnd={handleSeekEnd}
        onSeekMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const percent = ((e.clientX - rect.left) / rect.width) * 100;
          setHoverSeekPercent(percent);
          setHoverSeekTime((percent / 100) * duration);
        }}
        hoverSeekTime={hoverSeekTime}
        hoverSeekPercent={hoverSeekPercent}
        isHoveringSeek={isHoveringSeek}
        setIsHoveringSeek={setIsHoveringSeek}
        isHoveringControlsRef={isHoveringControlsRef}
      />
    </div>
  );
};
