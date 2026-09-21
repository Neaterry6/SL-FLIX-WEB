import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import { getOptimizedImageUrl, DEFAULT_FAVICON_FALLBACK } from '../utils/image';
interface Episode {
  episodeNumber: number;
  title?: string;
  description?: string;
  thumbnail?: string;
  duration?: string;
  isPremium?: boolean;
}
interface EpisodeListProps {
  seasonNumber: number;
  episodes: Episode[];
  currentEpisode: number;
  onEpisodeSelect: (episodeNumber: number) => void;
  movieId: string;
  isLoading?: boolean;
  className?: string;
}
interface EpisodeRowProps {
  episode: Episode;
  episodeNumber: number;
  isActive: boolean;
  isWatched?: boolean;
  onClick: () => void;
  index: number;
}
const EpisodeRow: React.FC<EpisodeRowProps> = ({
  episode,
  episodeNumber,
  isActive,
  isWatched,
  onClick,
  index
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [showFadeIn, setShowFadeIn] = useState(false);
  const rowRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => setShowFadeIn(true), index * 50);
    return () => clearTimeout(timer);
  }, [index]);
  useEffect(() => {
    if (isActive && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [isActive]);
  return (
    <button
      ref={rowRef}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`
        w-full flex items-center gap-4 p-3 rounded-xl transition-all duration-300
        ${showFadeIn ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}
        ${isActive 
          ? 'bg-primary/20 border-2 border-primary shadow-[0_0_15px_rgba(0,229,255,0.3)]' 
          : isWatched
            ? 'bg-white/5 border border-emerald-500/50 opacity-80'
            : isHovered 
              ? 'bg-white/10 border border-white/10' 
              : 'hover:bg-white/5 border border-transparent'
        }
      `}
    >
      {}
      <div className={`
        w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 font-bold text-lg
        ${isActive ? 'bg-primary text-black' : 'bg-white/10 text-gray-400'}
      `}>
        {episodeNumber}
      </div>
      {}
      <div className="relative w-32 h-18 rounded-lg overflow-hidden flex-shrink-0 bg-white/10">
        <LazyLoadImage
          src={getOptimizedImageUrl(episode.thumbnail, 320)}
          alt={episode.title || `Episode ${episodeNumber}`}
          effect="blur"
          className={`
            w-full h-full object-cover transition-all duration-300
            ${isHovered ? 'scale-110' : ''}
          `}
          wrapperClassName="w-full h-full"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            if (target.src !== DEFAULT_FAVICON_FALLBACK) {
              target.src = DEFAULT_FAVICON_FALLBACK;
            }
          }}
        />
        {}
        {episode.duration && (
          <div className="absolute bottom-1 right-1 bg-black/80 px-1.5 py-0.5 rounded text-[10px] text-white font-medium">
            {episode.duration}
          </div>
        )}
        {}
        {episode.isPremium && (
          <div className="absolute top-1 right-1 bg-yellow-500 px-1.5 py-0.5 rounded text-[10px] text-black font-bold">
            PREMIUM
          </div>
        )}
        {}
        <div className={`
          absolute inset-0 flex items-center justify-center bg-black/50
          transition-opacity duration-200
          ${isHovered || isActive ? 'opacity-100' : 'opacity-0'}
        `}>
          <div className={`
            w-12 h-12 rounded-full flex items-center justify-center
            ${isActive ? 'bg-primary text-black' : 'bg-white text-black'}
          `}>
            <svg className="w-5 h-5 ml-1" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
            </svg>
          </div>
        </div>
      </div>
      {}
      <div className="flex-1 text-left min-w-0">
        <h4 className={`
          text-sm font-semibold truncate transition-colors
          ${isActive ? 'text-primary' : isWatched ? 'text-emerald-400' : 'text-white'}
        `}>
          {episode.title || `Episode ${episodeNumber}`}
        </h4>
        {episode.description && (
          <p className="text-xs text-gray-500 line-clamp-2 mt-1">
            {episode.description}
          </p>
        )}
        <div className="flex items-center gap-2 mt-2">
          {isActive && (
            <span className="flex items-center gap-1 text-xs text-primary font-bold bg-primary/10 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              Now Playing
            </span>
          )}
          {isWatched && !isActive && (
            <span className="flex items-center gap-1 text-xs text-emerald-500 font-bold bg-emerald-500/10 px-2 py-0.5 rounded-full">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Watched
            </span>
          )}
          <span className="text-xs text-gray-600">
            Season {episodeNumber}
          </span>
        </div>
      </div>
      {}
      <div className="flex-shrink-0">
        {isActive ? (
          <div className="w-3 h-3 rounded-full bg-primary animate-pulse shadow-[0_0_10px_rgba(0,229,255,0.8)]" />
        ) : isWatched ? (
          <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
        ) : (
          <div className="w-3 h-3 rounded-full border-2 border-gray-600" />
        )}
      </div>
    </button>
  );
};
const EpisodeRowSkeleton: React.FC = () => (
  <div className="flex items-center gap-4 p-3 animate-pulse">
    <div className="w-10 h-10 rounded-lg bg-white/10" />
    <div className="w-32 h-18 rounded-lg bg-white/10" />
    <div className="flex-1 space-y-2">
      <div className="w-3/4 h-4 bg-white/10 rounded" />
      <div className="w-1/2 h-3 bg-white/10 rounded" />
    </div>
  </div>
);
const EpisodeList: React.FC<EpisodeListProps> = ({
  seasonNumber,
  episodes = [],
  currentEpisode,
  onEpisodeSelect,
  movieId,
  isLoading = false,
  className = ''
}) => {
  const [visibleCount, setVisibleCount] = useState(10);
  const containerRef = useRef<HTMLDivElement>(null);
  const [watchedProgress, setWatchedProgress] = useState<Record<string, any>>({});
  const loadProgress = () => {
    if (movieId) {
      const key = `slflix_progress_${movieId}`;
      const stored = localStorage.getItem(key);
      if (stored) {
        try {
          setWatchedProgress(JSON.parse(stored));
        } catch (e) {}
      }
    }
  };
  useEffect(() => {
    loadProgress();
    window.addEventListener('slflix_progress_update', loadProgress);
    return () => window.removeEventListener('slflix_progress_update', loadProgress);
  }, [movieId]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollTop + clientHeight >= scrollHeight * 0.8) {
        setVisibleCount(prev => Math.min(prev + 10, episodes.length));
      }
    };
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [episodes.length]);
  useEffect(() => {
    setVisibleCount(10);
  }, [seasonNumber]);
  const handleEpisodeClick = useCallback((episodeNumber: number) => {
    onEpisodeSelect(episodeNumber);
  }, [onEpisodeSelect]);
  if (isLoading) {
    return (
      <div className={`space-y-2 ${className}`}>
        {[1, 2, 3, 4, 5].map(i => (
          <EpisodeRowSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (!episodes || episodes.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
        </svg>
        <p>No episodes available for this season</p>
      </div>
    );
  }
  const visibleEpisodes = episodes.slice(0, visibleCount);
  const hasMore = visibleCount < episodes.length;
  return (
    <div ref={containerRef} className={`${className}`}>
      {}
      <div className="flex items-center justify-between mb-4 px-2">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-white font-semibold">
            Season {seasonNumber}
            <span className="ml-2 text-gray-500 font-normal text-sm">
              ({episodes.length} episodes)
            </span>
          </h3>
        </div>
        {}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const firstUnwatched = episodes.find(e => e.episodeNumber > currentEpisode);
              if (firstUnwatched) {
                onEpisodeSelect(firstUnwatched.episodeNumber);
              }
            }}
            disabled={currentEpisode >= episodes.length}
            className="text-xs text-primary hover:text-white transition-colors disabled:opacity-50"
          >
            Next Unwatched →
          </button>
        </div>
      </div>
      {}
      <div className="space-y-2">
        {visibleEpisodes.map((episode, index) => {
          const epKey = `S${seasonNumber}E${episode.episodeNumber}`;
          const progressData = watchedProgress[epKey];
          const isWatched = progressData?.completed || false;
          return (
            <EpisodeRow
              key={episode.episodeNumber}
              episode={episode}
              episodeNumber={episode.episodeNumber}
              isActive={episode.episodeNumber === currentEpisode}
              isWatched={isWatched}
              onClick={() => handleEpisodeClick(episode.episodeNumber)}
              index={index}
            />
          );
        })}
      </div>
      {}
      {hasMore && (
        <div className="py-4 text-center">
          <button
            onClick={() => setVisibleCount(prev => Math.min(prev + 10, episodes.length))}
            className="text-sm text-gray-500 hover:text-white transition-colors"
          >
            Show more episodes ({episodes.length - visibleCount} remaining)
          </button>
        </div>
      )}
      {}
      {visibleCount > 20 && (
        <button
          onClick={() => containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-20 right-4 w-10 h-10 bg-white/10 rounded-full flex items-center justify-center text-white hover:bg-white/20 transition-all"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        </button>
      )}
    </div>
  );
};
interface SeeAllEpisodesOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  seasons: { seasonNumber: number; episodeCount: number }[];
  currentSeason: number;
  currentEpisode: number;
  onSeasonSelect: (season: number) => void;
  onEpisodeSelect: (season: number, episode: number) => void;
}
export const SeeAllEpisodesOverlay: React.FC<SeeAllEpisodesOverlayProps> = ({
  isOpen,
  onClose,
  seasons,
  currentSeason,
  currentEpisode,
  onSeasonSelect,
  onEpisodeSelect
}) => {
  const [selectedSeason, setSelectedSeason] = useState(currentSeason);
  useEffect(() => {
    setSelectedSeason(currentSeason);
  }, [currentSeason]);
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-[#1a1a2e] rounded-2xl w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
        {}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h2 className="text-xl font-bold text-white">All Episodes</h2>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {}
        <div className="flex gap-2 p-4 border-b border-white/10 overflow-x-auto scrollbar-hide">
          {seasons.map(season => (
            <button
              key={season.seasonNumber}
              onClick={() => setSelectedSeason(season.seasonNumber)}
              className={`
                px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all
                ${selectedSeason === season.seasonNumber
                  ? 'bg-primary text-black'
                  : 'bg-white/10 text-gray-300 hover:bg-white/20'
                }
              `}
            >
              Season {season.seasonNumber}
            </button>
          ))}
        </div>
        {}
        <div className="flex-1 overflow-y-auto p-4">
          <EpisodeList
            seasonNumber={selectedSeason}
            episodes={Array.from({ length: seasons.find(s => s.seasonNumber === selectedSeason)?.episodeCount || 12 }, (_, i) => ({
              episodeNumber: i + 1
            }))}
            currentEpisode={selectedSeason === currentSeason ? currentEpisode : -1}
            onEpisodeSelect={(ep) => onEpisodeSelect(selectedSeason, ep)}
            movieId="demo-series-id"
          />
        </div>
      </div>
    </div>
  );
};
export default EpisodeList;