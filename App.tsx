import React, { useState, useEffect, useRef, useCallback, Suspense, Component, ErrorInfo } from 'react';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import { ApiService, RANKING_CATEGORIES } from './services/api';
import { updateMetaTags, resetToHomeSEO } from './services/seo';
import { CategoryData, MovieResult, VideoSource, Subtitle, ImdbSuggestion, MovieDub } from './types';
import Loader from './components/Loader';
import MovieCard from './components/MovieCard';
import VideoPlayer from './components/VideoPlayer';
import HomePage from './components/HomePage';
import LiveTv from './components/LiveTv';
import { Dock, DockIcon, DockItem, DockLabel } from "./components/Dock";
import NewsView from './components/NewsView';
import WebtoonView from './components/WebtoonView';
import WebtoonReader from './components/WebtoonReader';
import ApiDocsView from './components/ApiDocsView';
import { useHomeData } from './hooks/useHomeData';
import { useMovieDetails } from './hooks/useMovieDetails';
import { getOptimizedImageUrl } from './utils/image';
import BulkDownloadModal from './components/BulkDownloadModal';
import { 
  StarIcon, PlayIcon, PlusIcon, ShareIcon, BackIcon,
  ChevronRightIcon, CalendarIcon, TagIcon, HeartIcon, FilmIcon, TvIcon, 
  GlobeIcon, EpisodeIcon, InfoIcon, YoutubeIcon, CheckIcon, SpinnerIcon, CopyIcon
} from './components/Icons';

export class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', color: 'red', backgroundColor: 'black', minHeight: '100vh' }}>
          <h1>Something went wrong.</h1>
          <pre>{this.state.error?.toString()}</pre>
          <pre>{this.state.error?.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

interface SearchState {
    query: string;
    results: MovieResult[];
    loading: boolean;
    hasMore: boolean;
    nextPage: number;
    loadingMore: boolean;
}

interface ToastState {
    show: boolean;
    message: string;
    type: 'success' | 'error' | 'info';
    timeoutId?: ReturnType<typeof setTimeout>;
}

const Toast: React.FC<ToastState> = ({ show, message, type }) => {
    if (!show) return null;
    const colors = { success: 'border-primary', error: 'border-red-500', info: 'border-blue-500' };
    const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
    const iconColors = { success: 'text-primary', error: 'text-red-500', info: 'text-blue-500' };
    return (
        <div className={`fixed top-20 right-4 z-[3000] animate-fade-in px-6 py-4 rounded-xl border ${colors[type]} bg-black/90 shadow-2xl backdrop-blur-md flex items-center gap-3`}>
            <i className={`fa-solid ${icons[type]} ${iconColors[type]}`}></i>
            <span className="font-semibold text-white text-sm">{message}</span>
        </div>
    );
};

const LoadingView: React.FC = () => (
    <div className="fixed inset-0 z-[5000] bg-black/80 backdrop-blur-md flex flex-col items-center justify-center animate-fade-in">
        <Loader />
    </div>
);

const SourceSelector: React.FC<{
    isOpen: boolean; 
    sources: VideoSource[]; 
    subtitles?: Subtitle[];
    onClose: () => void; 
    onSelect: (source: VideoSource) => void;
    onToast: (msg: string) => void;
}> = ({ isOpen, sources, subtitles, onClose, onSelect, onToast }) => {
    const [downloading, setDownloading] = useState<string | null>(null);
    if (!isOpen) return null;

    const handleDownload = (e: React.MouseEvent, source: VideoSource) => {
        e.stopPropagation();
        const link = source.download || source.direct || source.stream;
        if (link) {
            setDownloading(source.label || 'file');
            onToast("Download started...");
            const anchor = document.createElement('a');
            anchor.href = link;
            anchor.target = '_blank';
            anchor.download = ''; 
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
            setTimeout(() => setDownloading(null), 2000);
        }
    };

    return (
        <div className="fixed inset-0 z-[2500] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-white">Select Quality</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white"><i className="fa-solid fa-times text-xl"></i></button>
                </div>
                
                {subtitles && subtitles.length > 0 && (
                    <div className="mb-4 p-3 bg-white/5 rounded-lg">
                        <p className="text-sm text-gray-400 mb-2"><i className="fa-solid fa-closed-captioning mr-2"></i>Subtitles: {subtitles.length} available</p>
                    </div>
                )}
                
                <div className="space-y-3 max-h-[50vh] overflow-y-auto scrollbar-hide">
                    {sources.map((s, i) => (
                        <div key={i} className="flex gap-2">
                             <button onClick={() => onSelect(s)} className="flex-1 bg-white/5 hover:bg-primary/20 hover:border-primary/50 border border-white/10 p-4 rounded-xl flex justify-between items-center transition-all group">
                                <div className="flex items-center gap-3">
                                    <span className={`px-2 py-1 rounded text-xs font-bold ${s.quality >= 1080 ? 'bg-primary text-black' : 'bg-gray-700 text-white'}`}>{s.label || (s.quality + 'p')}</span>
                                    <span className="text-sm text-gray-300 group-hover:text-white font-medium">Stream</span>
                                </div>
                                <i className="fa-solid fa-play text-gray-400 group-hover:text-primary"></i>
                            </button>
                            <button onClick={(e) => handleDownload(e, s)} className="bg-white/5 hover:bg-green-500/20 hover:border-green-500/50 border border-white/10 p-4 rounded-xl flex items-center justify-center transition-all group w-16" disabled={!!downloading}>
                                {downloading === (s.label || 'file') ? <i className="fa-solid fa-circle-notch fa-spin text-green-500"></i> : <i className="fa-solid fa-download text-gray-400 group-hover:text-green-500"></i>}
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

const Footer: React.FC = () => {
    const currentYear = new Date().getFullYear();
    return (
        <footer className="bg-[#0a0a15] border-t border-white/10 mt-auto pt-12 pb-8 px-[4%]">
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-col items-center text-center gap-6 mb-8">
                    <div className="text-3xl font-extrabold text-white">SL<span className="text-primary">FLIX</span></div>
                    <p className="text-gray-400 text-sm max-w-md">Your ultimate destination for streaming movies, series, and more. No ads, just entertainment.</p>
                </div>
                <div className="border-t border-white/10 pt-6 flex flex-col items-center gap-4">
                    <p className="text-gray-500 text-xs">© {currentYear} SLFLIX. All rights reserved.</p>
                    <p className="text-gray-400 text-sm">Powered by <span className="text-primary font-bold">SLFLIX</span></p>
                </div>
            </div>
        </footer>
    );
};

const RankingBadge: React.FC<{ rank: number }> = ({ rank }) => {
    const getBadgeStyle = () => {
        if (rank === 1) return { bg: 'bg-yellow-500', text: 'text-black', shadow: 'shadow-yellow-500/50' };
        else if (rank === 2) return { bg: 'bg-gray-400', text: 'text-black', shadow: 'shadow-gray-400/50' };
        else if (rank === 3) return { bg: 'bg-amber-700', text: 'text-white', shadow: 'shadow-amber-700/50' };
        return { bg: 'bg-white/10', text: 'text-white', shadow: '' };
    };
    const style = getBadgeStyle();
    return <div className={`w-8 h-8 md:w-10 md:h-10 rounded-lg ${style.bg} ${style.text} flex items-center justify-center font-bold text-sm md:text-lg shadow-lg ${style.shadow}`}>{rank}</div>;
};

const ToplistView: React.FC<{ initialCategory?: string; onMovieClick: (m: MovieResult) => void; onBack: () => void; }> = ({ initialCategory = 'trending', onMovieClick, onBack }) => {
    const [selectedCategory, setSelectedCategory] = useState(initialCategory);
    const [movies, setMovies] = useState<MovieResult[]>([]);
    const [loading, setLoading] = useState(true);
    const [hasMore, setHasMore] = useState(true);
    const [page, setPage] = useState(1);
    const [categoryTitle, setCategoryTitle] = useState('');
    const loadMoreRef = useRef<HTMLDivElement>(null);
    
    const loadMovies = useCallback(async (cat: string, pageNum: number, append = false) => {
        if (pageNum === 1) setLoading(true);
        try {
            const data = await ApiService.getRankingList(cat, pageNum);
            if (append) setMovies(prev => [...prev, ...data.results]);
            else setMovies(data.results);
            setCategoryTitle(data.title);
            setHasMore(data.hasMore);
            setPage(pageNum);
        } catch (e) {
            console.error("Failed to load ranking list:", e);
        } finally {
            setLoading(false);
        }
    }, []);
    
    useEffect(() => {
        setLoading(true);
        setMovies([]);
        setPage(1);
        ApiService.getRankingList(selectedCategory, 1).then(data => {
            setMovies(data.results);
            setCategoryTitle(data.title);
            setHasMore(data.hasMore);
            setLoading(false);
        }).catch(() => setLoading(false));
    }, [selectedCategory]);

    useEffect(() => {
        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && hasMore && !loading) {
                loadMovies(selectedCategory, page + 1, true);
            }
        }, { threshold: 0.1 });
        if (loadMoreRef.current) observer.observe(loadMoreRef.current);
        return () => observer.disconnect();
    }, [hasMore, loading, selectedCategory, page, loadMovies]);
    
    const scrollRef = useRef<HTMLDivElement>(null);
    
    return (
        <div className="flex flex-col md:flex-row min-h-[calc(100vh-64px)] pt-4 animate-fade-in">
            <div className="w-full md:w-64 flex-shrink-0 md:border-r border-white/10 pr-0 md:pr-4 mb-4 md:mb-0">
                <div className="sticky top-20">
                    <div className="flex items-center gap-2 mb-4 px-4 md:px-0">
                        <button onClick={onBack} className="md:hidden text-gray-400 hover:text-white"><i className="fa-solid fa-arrow-left text-xl"></i></button>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2"><i className="fa-solid fa-chart-line text-primary"></i> Top List</h2>
                    </div>
                    <div className="space-y-1 overflow-x-auto md:overflow-visible pb-2 md:pb-0">
                        {RANKING_CATEGORIES.map((cat) => (
                            <button key={cat.id} onClick={() => setSelectedCategory(cat.id)} className={`w-full md:w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 transition-all ${selectedCategory === cat.id ? 'bg-primary text-black font-bold' : 'text-gray-300 hover:bg-white/5 hover:text-white'}`}>
                                <i className={`fa-solid ${cat.icon} ${selectedCategory === cat.id ? '' : 'text-gray-500'}`}></i>
                                <span className="text-sm truncate">{cat.name}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
            <div className="flex-1 px-4 md:pl-6 pb-24" ref={scrollRef}>
                <h3 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">{categoryTitle || RANKING_CATEGORIES.find(c => c.id === selectedCategory)?.name}<span className="text-gray-500 text-sm font-normal">({movies.length} items)</span></h3>
                {loading && page === 1 ? <div className="flex justify-center py-20"><div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div></div> : movies.length > 0 ? (
                    <>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                            {movies.map((movie, index) => (
                                <div key={index} className="flex items-start gap-3 bg-white/5 hover:bg-white/10 rounded-xl p-2 transition-all cursor-pointer group" onClick={() => onMovieClick(movie)}>
                                    <RankingBadge rank={index + 1} />
                                    <div className="flex-1 min-w-0">
                                        <div className="w-16 h-20 md:w-20 md:h-28 rounded-lg overflow-hidden flex-shrink-0 shadow-lg">
                                            <LazyLoadImage src={getOptimizedImageUrl(movie.cover, 200)} alt={movie.title} effect="blur" className="w-full h-full object-cover" wrapperClassName="w-full h-full" onError={(e) => { (e.target as HTMLImageElement).src = `https://picsum.photos/seed/${movie.subjectId || Math.random()}/200/300`; }} />
                                        </div>
                                        <h4 className="text-white text-xs font-medium mt-2 truncate group-hover:text-primary transition-colors">{movie.title}</h4>
                                        <p className="text-gray-500 text-[10px]">{movie.releaseDate?.split('-')[0]}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div ref={loadMoreRef} className="flex justify-center py-8">
                            {loading && <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>}
                            {!hasMore && movies.length > 0 && <p className="text-gray-500 text-xs uppercase tracking-wider font-bold">No more content</p>}
                        </div>
                    </>
                ) : <div className="text-center py-20"><div className="text-6xl mb-4 text-gray-600"><i className="fa-solid fa-film"></i></div><p className="text-gray-400 text-lg">No content available</p></div>}
            </div>
        </div>
    );
};

const Navbar: React.FC<{ onSearch: (q: string) => void, onHome: () => void, onToplist: () => void, onLiveTv: () => void, onNews: () => void, onWebtoon: () => void, isSearchOpen: boolean, setIsSearchOpen: (v: boolean) => void, trendingKeywords: string[], currentView: string }> = ({ onSearch, onHome, onToplist, onLiveTv, onNews, onWebtoon, isSearchOpen, setIsSearchOpen, trendingKeywords, currentView }) => {
    const [val, setVal] = useState('');
    const [suggestions, setSuggestions] = useState<ImdbSuggestion[]>([]);
    
    useEffect(() => {
        const timer = setTimeout(async () => {
            if (val.trim().length > 2) {
                const suggs = await ApiService.getImdbSuggestions(val);
                setSuggestions(suggs);
            } else { setSuggestions([]); }
        }, 300);
        return () => clearTimeout(timer);
    }, [val]);

    const submit = (q: string) => {
        const query = q.trim();
        if (!query) return;
        onSearch(query);
        setIsSearchOpen(false);
        setVal('');
        setSuggestions([]);
    };

    return (
        <>
            <nav className="sticky top-0 z-[100] bg-[#0a0a15]/95 backdrop-blur-md px-[4%] h-16 flex justify-between items-center border-b border-white/5 pt-safe">
                <div className="flex items-center gap-4">
                    <button onClick={onHome} className="text-xl font-extrabold text-white flex items-center gap-1 select-none">SL<span className="text-primary">FLIX</span></button>
                    <button onClick={onToplist} className={`hidden text-sm font-medium ${currentView === 'toplist' ? 'text-primary' : 'text-gray-300 hover:text-primary'}`}><i className="fa-solid fa-chart-line"></i><span>Top List</span></button>
                    <button onClick={onLiveTv} className={`hidden text-sm font-medium ${currentView === 'live-tv' ? 'text-primary' : 'text-gray-300 hover:text-primary'}`}><i className="fa-solid fa-satellite-dish"></i><span>Live TV</span></button>
                    <button onClick={onNews} className={`hidden text-sm font-medium ${currentView === 'news' ? 'text-primary' : 'text-gray-300 hover:text-primary'}`}><i className="fa-solid fa-newspaper"></i><span>News</span></button>
                    <button onClick={onWebtoon} className={`hidden text-sm font-medium ${currentView === 'webtoon' ? 'text-primary' : 'text-gray-300 hover:text-primary'}`}><i className="fa-solid fa-book-open text-primary"></i><span>Toon</span></button>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => setIsSearchOpen(true)} className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-gray-300 hover:text-primary transition-colors"><i className="fa-solid fa-search"></i></button>
                </div>
            </nav>
            {isSearchOpen && (
                <div className="fixed inset-0 z-[110] bg-[#0a0a15]/98 backdrop-blur-xl p-4 pt-safe animate-fade-in flex flex-col">
                    <div className="flex gap-4 mb-4">
                        <input autoFocus type="text" className="flex-1 bg-white/10 border-none rounded-full py-3 px-6 text-white outline-none focus:ring-2 focus:ring-primary" placeholder="Search movies, series..." value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if(e.key === 'Enter') submit(val); if(e.key === 'Escape') setIsSearchOpen(false); }} />
                        <button onClick={() => setIsSearchOpen(false)} className="text-white font-bold">Cancel</button>
                    </div>
                    <div className="flex-1 overflow-y-auto pb-10">
                        {val.trim().length === 0 && trendingKeywords.length > 0 && (
                            <div className="mb-8">
                                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2"><i className="fa-solid fa-fire text-orange-500"></i> Trending Searches</h3>
                                <div className="flex flex-wrap gap-2">{trendingKeywords.map((k, i) => (<button key={i} onClick={() => submit(k)} className="bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-2 rounded-full text-sm text-gray-300 transition-colors">{k}</button>))}</div>
                            </div>
                        )}
                        {suggestions.length > 0 && (
                            <div className="space-y-1">
                                {suggestions.map(s => (
                                    <div key={s.id} onClick={() => submit(s.l)} className="flex items-center gap-3 p-3 hover:bg-white/10 rounded-lg cursor-pointer transition-colors group">
                                        <div className="w-10 h-14 bg-white/5 rounded-lg overflow-hidden flex-none">{s.i && <LazyLoadImage src={getOptimizedImageUrl(s.i.imageUrl, 100)} effect="blur" className="w-full h-full object-cover group-hover:scale-110 transition-transform" wrapperClassName="w-full h-full" />}</div>
                                        <div className="flex-1"><div className="text-white font-bold text-sm leading-tight">{s.l}</div><div className="text-gray-500 text-[10px] mt-1">{s.q || 'Movie'} {s.y ? `• ${s.y}` : ''}</div></div>
                                        <i className="fa-solid fa-arrow-up-right-from-square text-gray-600 text-xs group-hover:text-primary"></i>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
};

const DetailsView: React.FC<{ movie: MovieResult, onBack: () => void,
    onFetchSources: (title: string, season: number, episode: number, subjectId?: string, detailPath?: string) => void, 
    onPlayTrailer: () => void, 
    onMovieClick: (m: MovieResult) => void, 
    onDubClick: (dub: MovieDub) => void, 
    loading: boolean
}> = ({ movie, onBack, onFetchSources, onPlayTrailer, onMovieClick, onDubClick, loading }) => {
    const [selectedSeason, setSelectedSeason] = useState(1);
    const [copied, setCopied] = useState(false);
    const [toastMessage, setToastMessage] = useState<string | null>(null);
    const [showBulkModal, setShowBulkModal] = useState(false);
    const [watchedProgress, setWatchedProgress] = useState<Record<string, any>>({});

    const loadProgress = () => {
        if (movie.subjectId) {
            const key = `slflix_progress_${movie.subjectId}`;
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
    }, [movie.subjectId]);

    const showToast = (message: string) => {
        setToastMessage(message);
        setTimeout(() => setToastMessage(null), 3000);
    };

    const handleBulkDownload = async (urls: string[]) => {
        showToast('Fetching download links...');
        try {
            const links = [];
            for (const url of urls) {
                const res = await fetch(url).then(r => r.json());
                if (res.results && res.results.length > 0) {
                    const best = res.results.reduce((prev: any, current: any) => (parseInt(prev.quality) > parseInt(current.quality)) ? prev : current);
                    if (best.download) links.push(best.download);
                }
            }
            if (links.length > 0) {
                const text = links.join('\n');
                const blob = new Blob([text], { type: 'text/plain' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `${movie.title}_Season_${selectedSeason}_links.txt`;
                a.click();
                showToast('Download links saved!');
            } else {
                showToast('No links found.');
            }
        } catch (e) {
            showToast('Failed to fetch links.');
        }
    };

    const handleCopyLink = () => {
        const url = window.location.href;
        navigator.clipboard.writeText(url).then(() => {
            setCopied(true);
            showToast('Link copied!');
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const isSeries = movie.type.includes('Series') || movie.type.includes('TV');
    
    const hasSeasons = movie.seasons && movie.seasons.length > 0;
    const currentSeasonData = movie.seasons?.find(s => s.seasonNumber === selectedSeason);
    const episodeCount = currentSeasonData?.episodeCount || 0;
    
    const showSeasons = hasSeasons;

    const [recPage, setRecPage] = useState(0);
    const recsPerPage = 6;
    const maxRecPages = movie.recommendations ? Math.ceil(movie.recommendations.length / recsPerPage) : 0;
    const currentRecs = movie.recommendations?.slice(recPage * recsPerPage, (recPage + 1) * recsPerPage) || [];

    if (loading || !movie.title || movie.title === "Loading...") {
        return (
            <div className="min-h-screen bg-[#0a0a15] animate-fade-in pb-20">
                <div className="relative h-[40vh] md:h-[60vh]">
                    <div className="absolute top-4 left-4 z-20">
                        <button className="bg-black/40 backdrop-blur-md border border-white/10 w-10 h-10 rounded-full text-white flex items-center justify-center">
                            <BackIcon className="w-5 h-5" />
                        </button>
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a15] via-[#0a0a15]/40 to-transparent"></div>
                    <div className="absolute bottom-0 left-0 w-full p-[4%] flex flex-col md:flex-row items-end gap-6">
                        <div className="hidden md:block w-[200px] h-[280px] rounded-xl bg-white/10 animate-pulse"></div>
                        <div className="flex-1 space-y-4">
                            <div className="h-10 md:h-14 w-3/4 bg-white/10 rounded-lg animate-pulse"></div>
                            <div className="h-6 w-1/2 bg-white/10 rounded animate-pulse"></div>
                            <div className="h-12 w-40 bg-white/10 rounded-full animate-pulse"></div>
                        </div>
                    </div>
                </div>
                <div className="px-[4%] mt-8 space-y-6">
                    <div className="h-48 bg-white/5 rounded-xl border border-white/10 p-6">
                        <div className="h-6 w-24 bg-white/10 rounded mb-4 animate-pulse"></div>
                        <div className="space-y-2">
                            <div className="h-4 w-full bg-white/10 rounded animate-pulse"></div>
                            <div className="h-4 w-full bg-white/10 rounded animate-pulse"></div>
                            <div className="h-4 w-3/4 bg-white/10 rounded animate-pulse"></div>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                        {[1,2,3,4,5,6,7,8].map(i => (
                            <div key={i} className="aspect-[2/3] bg-white/5 rounded-xl animate-pulse"></div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0a0a15] animate-fade-in pb-20 relative">
            {toastMessage && (
                <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-emerald-500 text-white px-6 py-3 rounded-full shadow-lg font-bold animate-fade-in flex items-center gap-2">
                    <CheckIcon className="w-5 h-5" />
                    {toastMessage}
                </div>
            )}
            <div className="relative h-[40vh] md:h-[60vh]">
                <div className="absolute top-4 left-4 z-20"><button onClick={onBack} className="bg-black/40 backdrop-blur-md border border-white/10 w-10 h-10 rounded-full text-white flex items-center justify-center hover:bg-white/20 transition-colors"><BackIcon className="w-5 h-5" /></button></div>
                <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${getOptimizedImageUrl(movie.cover, 1280)})` }}></div>
                <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a15] via-[#0a0a15]/40 to-transparent"></div>
                <div className="absolute bottom-0 left-0 w-full p-[4%] flex flex-col md:flex-row items-end gap-6">
                    <div className="hidden md:block w-[200px] rounded-xl overflow-hidden shadow-2xl border border-white/10"><LazyLoadImage src={getOptimizedImageUrl(movie.thumbnail || movie.cover, 400)} effect="blur" className="w-full h-full object-cover" wrapperClassName="w-full h-full" /></div>
                    <div className="flex-1">
                        <h1 className="text-3xl md:text-5xl font-extrabold text-white mb-2 drop-shadow-lg">{movie.title}</h1>
                        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-300 mb-4">
                            {movie.imdbRating && movie.imdbRating !== '0' && <span className="text-primary font-bold flex items-center gap-1"><StarIcon className="w-4 h-4" filled />{movie.imdbRating}</span>}
                            {movie.releaseDate && <span className="flex items-center gap-1"><CalendarIcon className="w-4 h-4" />{movie.releaseDate.split('-')[0]}</span>}
                            <span className="bg-white/10 px-2 py-0.5 rounded text-xs border border-white/10 flex items-center gap-1">{isSeries ? <TvIcon className="w-3 h-3" /> : <FilmIcon className="w-3 h-3" />}{movie.type}</span>
                            {movie.genre && <span className="flex items-center gap-1"><TagIcon className="w-4 h-4" />{movie.genre}</span>}
                        </div>
                        <div className="flex gap-4 flex-wrap">
                            {!isSeries && <button onClick={() => onFetchSources(movie.title, 1, 1, movie.subjectId, movie.detailPath)} disabled={loading || movie.hasResource === false} className={`bg-primary text-black font-bold py-3 px-8 rounded-full hover:bg-white transition-all flex items-center gap-2 shadow-[0_0_20px_rgba(0,229,255,0.3)] group ${movie.hasResource === false ? 'opacity-50 cursor-not-allowed grayscale' : ''}`}>{loading ? <SpinnerIcon className="w-5 h-5" /> : <PlayIcon className="w-5 h-5" />} Play</button>}
                            {movie.trailerUrl && <button onClick={onPlayTrailer} className="bg-white/10 border border-white/20 text-white font-bold py-3 px-6 rounded-full hover:bg-white/20 transition-all flex items-center gap-2"><YoutubeIcon className="w-5 h-5" /> Trailer</button>}
                            <button onClick={handleCopyLink} className="bg-white/10 border border-white/20 text-white font-bold py-3 px-6 rounded-full hover:bg-white/20 transition-all flex items-center gap-2">
                                {copied ? <CheckIcon className="w-5 h-5 text-primary" /> : <CopyIcon className="w-5 h-5" />}
                                {copied ? 'Copied!' : 'Copy Link'}
                            </button>
                            <button onClick={() => {
                                const isSeries = movie.type?.toLowerCase().includes('series') || movie.type?.toLowerCase().includes('tv');
                                const url = `${window.location.origin}${isSeries ? '/tv/' : '/movie/'}${movie.subjectId || movie.detailPath}`;
                                if (navigator.share) {
                                    navigator.share({
                                        title: movie.title,
                                        text: `${movie.title} - Watch free HD online`,
                                        url: url
                                    }).then(() => {
                                        showToast('Shared successfully!');
                                    }).catch((err) => {
                                        if (err.name !== 'AbortError') {
                                            showToast('Failed to share');
                                        }
                                    });
                                } else {
                                    navigator.clipboard.writeText(url);
                                    setCopied(true);
                                    showToast('Link copied!');
                                    setTimeout(() => setCopied(false), 2000);
                                }
                            }} className="bg-white/10 border border-white/20 text-white font-bold py-3 px-4 rounded-full hover:bg-white/20 transition-all flex items-center gap-2"><ShareIcon className="w-5 h-5" /> Share</button>
                            
                            {isSeries && (
                                <>
                                    <button onClick={() => setShowBulkModal(true)} className="bg-emerald-500/20 border border-emerald-500/50 text-emerald-400 font-bold py-3 px-4 rounded-full hover:bg-emerald-500/30 transition-all flex items-center gap-2">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10l-5.5 5.5m0 0L7.5 20l5-5m-5 5L17 10m0 0V6m0 4h4" />
                                        </svg>
                                        Bulk Download
                                    </button>
                                    {showBulkModal && (
                                        <BulkDownloadModal
                                            isOpen={showBulkModal}
                                            movieId={movie.subjectId || movie.detailPath || ''}
                                            seasonNumber={selectedSeason}
                                            onClose={() => setShowBulkModal(false)}
                                            onDownload={handleBulkDownload}
                                        />
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            <div className="px-[4%] mt-6 grid grid-cols-1 lg:grid-cols-3 gap-10">
                <div className="lg:col-span-2 space-y-8">
                    {movie.dubs && movie.dubs.length > 1 && (
                        <div className="bg-white/5 p-4 rounded-xl border border-white/10">
                            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2"><GlobeIcon className="w-4 h-4" /> Audio/Dub Versions</h3>
                            <div className="flex flex-wrap gap-2">{movie.dubs.map((dub, i) => (<button key={i} onClick={() => onDubClick(dub)} className={`px-4 py-2 rounded-full text-xs font-bold border transition-all flex items-center gap-1 ${dub.detailPath === movie.detailPath ? 'bg-primary text-black border-primary' : 'bg-white/5 text-white border-white/10 hover:bg-white/10'}`}>{dub.original && <CheckIcon className="w-3 h-3" />}{dub.lanName}</button>))}</div>
                        </div>
                    )}
                    <div className="bg-[#1a1a2e] p-6 rounded-xl border border-white/5">
                        <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2"><InfoIcon className="w-5 h-5 text-primary" /> Synopsis</h3>
                        <p className="text-gray-400 leading-relaxed text-sm md:text-base">{movie.description || "No description available."}</p>
                    </div>
                    
                    {movie.cast && movie.cast.length > 0 && (
                        <div className="bg-[#1a1a2e] p-6 rounded-xl border border-white/5">
                            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><i className="fa-solid fa-users text-primary"></i> Cast</h3>
                            <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
                                {movie.cast.slice(0, 10).map((actor, i) => (
                                    <div key={i} className="flex-shrink-0 text-center group">
                                        <div className="w-20 h-20 md:w-24 md:h-24 rounded-full overflow-hidden border-2 border-white/10 group-hover:border-primary transition-all mx-auto mb-2">
                                            {actor.avatar ? (
                                                <LazyLoadImage src={getOptimizedImageUrl(actor.avatar, 150)} alt={actor.name} effect="blur" className="w-full h-full object-cover" wrapperClassName="w-full h-full" onError={(e) => { (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(actor.name)}&background=1a1a2e&color=fff&size=128`; }} />
                                            ) : (
                                                <div className="w-full h-full bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center">
                                                    <i className="fa-solid fa-user text-white/50 text-2xl"></i>
                                                </div>
                                            )}
                                        </div>
                                        <p className="text-white text-xs font-medium truncate max-w-[90px] md:max-w-[100px] group-hover:text-primary transition-colors">{actor.name}</p>
                                        {actor.character && <p className="text-gray-500 text-[10px] truncate max-w-[90px] md:max-w-[100px]">{actor.character}</p>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    
                    {isSeries && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between"><h3 className="text-xl font-bold text-white flex items-center gap-2"><EpisodeIcon className="w-5 h-5 text-primary" /> Episodes</h3></div>
                            {showSeasons && <div className="flex gap-2 flex-wrap mb-4">{movie.seasons!.map(season => (<button key={season.seasonNumber} onClick={() => setSelectedSeason(season.seasonNumber)} className={`px-4 py-2 rounded-full text-sm font-bold ${selectedSeason === season.seasonNumber ? 'bg-primary text-black' : 'bg-white/10 text-white hover:bg-white/20'}`}>Season {season.seasonNumber}</button>))}</div>}
                            
                            {showSeasons && episodeCount > 0 && (
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                    {Array.from({ length: episodeCount }, (_, i) => i + 1).map(ep => {
                                        const epKey = `S${selectedSeason}E${ep}`;
                                        const progressData = watchedProgress[epKey];
                                        const progress = progressData?.progress || 0;
                                        const isCompleted = progressData?.completed || false;
                                        
                                        return (
                                            <button 
                                                key={ep} 
                                                onClick={() => onFetchSources(movie.title, selectedSeason, ep, movie.subjectId, movie.detailPath)} 
                                                disabled={loading} 
                                                className="bg-[#1a1a2e] hover:bg-white/10 border border-white/10 p-3 rounded-xl relative overflow-hidden group transition-all text-left"
                                            >
                                                <span className="text-gray-500 text-xs uppercase mb-1 flex items-center justify-between">
                                                    <span className="flex items-center gap-1"><EpisodeIcon className="w-3 h-3" /> Episode</span>
                                                    {isCompleted && <CheckIcon className="w-3 h-3 text-emerald-500" />}
                                                </span> 
                                                <span className="text-white text-xl font-bold block mb-2">{ep}</span>
                                                {progress > 0 && (
                                                    <div className="absolute bottom-0 left-0 w-full h-1 bg-white/10">
                                                        <div className={`h-full ${isCompleted ? 'bg-emerald-500' : 'bg-primary'}`} style={{ width: `${progress}%` }}></div>
                                                    </div>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                            {!showSeasons && <div className="text-center py-8 text-gray-400 bg-white/5 rounded-xl border border-white/10">
                                <p className="mb-4">No season information available.</p>
                                <button onClick={() => onFetchSources(movie.title, 1, 1, movie.subjectId, movie.detailPath)} disabled={loading} className="bg-primary text-black font-bold py-2 px-6 rounded-full hover:bg-white transition-all">
                                    {loading ? 'Loading...' : 'Play Now'}
                                </button>
                            </div>}
                        </div>
                    )}
                </div>
                <div className="lg:col-span-1">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xl font-bold text-white flex items-center gap-2"><HeartIcon className="w-5 h-5 text-primary" /> You Might Also Like</h3>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                        {currentRecs.map((rec, i) => (
                            <div key={`${recPage}-${i}`} className="animate-fade-in">
                                <MovieCard movie={rec} onClick={onMovieClick} />
                            </div>
                        ))}
                    </div>
                    {currentRecs.length === 0 && <p className="text-gray-500 text-sm">No recommendations found.</p>}
                    {maxRecPages > 1 && (
                        <div className="mt-4 flex justify-center">
                            <button 
                                onClick={() => setRecPage((prev) => (prev + 1) % maxRecPages)}
                                className="px-6 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-sm font-bold text-white transition-all flex items-center gap-2"
                            >
                                See More <i className="fa-solid fa-chevron-right text-[10px]"></i>
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const TrendingView: React.FC<{ movies: MovieResult[], loading: boolean, hasMore: boolean, onLoadMore: () => void, onMovieClick: (m: MovieResult) => void }> = ({ movies, loading, hasMore, onLoadMore, onMovieClick }) => {
    const loadMoreRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const observer = new IntersectionObserver((entries) => { if (entries[0].isIntersecting && hasMore && !loading) onLoadMore(); }, { threshold: 0.1 });
        if (loadMoreRef.current) observer.observe(loadMoreRef.current);
        return () => observer.disconnect();
    }, [hasMore, loading, onLoadMore]);
    return (
        <div className="pt-8 px-[4%] pb-24">
            <div className="mb-6"><h2 className="text-2xl font-bold text-white flex items-center gap-2"><i className="fa-solid fa-fire text-orange-500"></i> Trending</h2><p className="text-gray-400 text-sm mt-1">Most popular movies and series right now</p></div>
            {movies.length > 0 ? (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">{movies.map((m, i) => (<div key={i} className="transform transition-all duration-300 hover:scale-105 hover:z-10"><MovieCard movie={m} onClick={onMovieClick} /></div>))}</div>
                    <div ref={loadMoreRef} className="flex justify-center py-8">{loading && <Loader type="circle" inline />}{!hasMore && movies.length > 0 && <p className="text-gray-500">No more content</p>}</div>
                </>
            ) : <div className="col-span-full text-center py-20"><div className="text-6xl mb-4 text-gray-600"><i className="fa-solid fa-fire"></i></div><p className="text-gray-400 text-lg">No trending content available</p></div>}
        </div>
    );
};

const normalizeTrendingItem = (item: any): MovieResult => {
    if (!item) return {} as MovieResult;
    let cover = '';
    if (typeof item.cover === 'string') cover = item.cover;
    else if (item.cover?.url) cover = item.cover.url;
    return { title: item.title || "Unknown", cover, thumbnail: cover, type: item.subjectType === 1 ? 'Movie' : item.subjectType === 2 ? 'TV Series' : 'Movie', subjectId: String(item.subjectId || ''), imdbRating: String(item.imdbRatingValue || '0'), releaseDate: String(item.releaseDate || ''), genre: item.genre || '', description: item.description || item.postTitle || '', countryName: item.countryName || '', detailPath: item.detailPath || '', hasResource: item.hasResource !== undefined ? item.hasResource : true };
};

const App: React.FC = () => {
    const [currentView, setCurrentView] = useState<'home' | 'search' | 'details' | 'trending' | 'toplist' | 'api-docs' | 'live-tv' | 'webtoon' | 'webtoon-reader' | 'sports' | 'news'>('home');
    const [readerState, setReaderState] = useState<{ isOpen: boolean; url: string; title: string }>({ isOpen: false, url: '', title: '' });
    const [webtoonUrl, setWebtoonUrl] = useState<string | null>(null);
    const { data: homeData, loading: homeLoading, error: homeError } = useHomeData();
    const heroMovies = homeData?.hero || [];
    const categoriesData = homeData?.categories || [];
    const [selectedMovie, setSelectedMovie] = useState<MovieResult | null>(null);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [trendingKeywords, setTrendingKeywords] = useState<string[]>([]);
    const [toplistCategory, setToplistCategory] = useState('trending');
    const [trendingMovies, setTrendingMovies] = useState<MovieResult[]>([]);
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const searchLoadMoreRef = useRef<HTMLDivElement>(null);
    const [trendingLoading, setTrendingLoading] = useState(false);
    const [trendingHasMore, setTrendingHasMore] = useState(true);
    const [trendingPage, setTrendingPage] = useState(0);
    const [searchState, setSearchState] = useState<SearchState>({ query: '', results: [], loading: false, hasMore: false, nextPage: 1, loadingMore: false });
    const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'info' });
    const [playerState, setPlayerState] = useState<{ isOpen: boolean; title: string; sources: VideoSource[]; subtitles?: Subtitle[]; subjectId?: string; detailPath?: string; mediaType?: string; season?: number; episode?: number; initialTime?: number; nextEpisode?: { season: number; episode: number; title: string }; isTrailer?: boolean; isLive?: boolean; startTime?: number; overlay?: boolean; }>({ isOpen: false, title: '', sources: [] });
    const [sourceModal, setSourceModal] = useState<{ isOpen: boolean; sources: VideoSource[]; subtitles?: Subtitle[]; pendingContext?: { title: string; season: number; episode: number; initialTime: number; subjectId?: string; detailPath?: string; mediaType?: string; }; }>({ isOpen: false, sources: [] });
    const [loadingDetails, setLoadingDetails] = useState(false);
    const [loadingSources, setLoadingSources] = useState(false);
    const categoriesDataRef = useRef(categoriesData);
    const playerStateRef = useRef(playerState);
    
    useEffect(() => { categoriesDataRef.current = categoriesData; }, [categoriesData]);
    useEffect(() => { playerStateRef.current = playerState; }, [playerState]);

    const loadTrending = async (page: number) => {
        if (page === 0) setTrendingLoading(true);
        else setSearchState(prev => ({ ...prev, loadingMore: true }));
        try {
            const response = await fetch(`https://h5-api.aoneroom.com/wefeed-h5api-bff/subject/trending?page=${page}&perPage=18`);
            const data = await response.json();
            if (data.code === 0 && data.data?.subjectList) {
                const results = data.data.subjectList.map(normalizeTrendingItem);
                if (page === 0) setTrendingMovies(results);
                else setTrendingMovies(prev => [...prev, ...results]);
                setTrendingHasMore(data.data.pager?.hasMore || false);
            } else { setTrendingHasMore(false); }
        } catch (e) { console.error('Error loading trending:', e); setTrendingHasMore(false); }
        if (page === 0) setTrendingLoading(false);
        else setSearchState(prev => ({ ...prev, loadingMore: false }));
        setTrendingPage(page);
    };

    const handleSearch = useCallback(async (q: string, page: number = 1) => {
        if (!q.trim()) return;
        if (page === 1) setSearchState(prev => ({ ...prev, loading: true, query: q }));
        else setSearchState(prev => ({ ...prev, loadingMore: true }));
        setCurrentView('search');
        if (page === 1) window.history.pushState({}, '', `/search?q=${encodeURIComponent(q)}`);
        const res = await ApiService.search(q, page);
        if (page === 1) setSearchState({ query: q, results: res.results, loading: false, hasMore: res.hasMore, nextPage: res.nextPage, loadingMore: false });
        else setSearchState(prev => ({ ...prev, results: [...prev.results, ...res.results], loadingMore: false, hasMore: res.hasMore, nextPage: res.nextPage }));
    }, []);

    useEffect(() => {
        if (currentView !== 'search') return;
        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && searchState.hasMore && !searchState.loading && !searchState.loadingMore) {
                handleSearch(searchState.query, searchState.nextPage);
            }
        }, { threshold: 0.1 });
        if (searchLoadMoreRef.current) observer.observe(searchLoadMoreRef.current);
        return () => observer.disconnect();
    }, [currentView, searchState.hasMore, searchState.loading, searchState.loadingMore, searchState.query, searchState.nextPage, handleSearch]);

    const handleMovieClick = async (m: MovieResult) => {
        setLoadingDetails(true);
        const prefix = m.type.includes('Series') ? '/tv/' : '/movie/';
        window.history.pushState({}, '', `${prefix}${m.subjectId || m.detailPath}`);
        setCurrentView('details');
        setSelectedMovie(m);
        window.scrollTo(0,0);
        updateMetaTags(m, false);
        try {
            const fullDetails = await ApiService.getDetails(m);
            setSelectedMovie(fullDetails);
            updateMetaTags(fullDetails, false);
        } catch { setToast({ show: true, message: "Error loading details", type: "error" }); }
        finally { setLoadingDetails(false); }
    };

    const handleToplistClick = (category?: string) => {
        if (category) setToplistCategory(category);
        setCurrentView('toplist');
        window.history.pushState({}, '', '/toplist');
        resetToHomeSEO();
    };

    useEffect(() => {
        const handlePopState = async () => {
            const path = window.location.pathname;
            const searchParams = new URLSearchParams(window.location.search);
            const q = searchParams.get('q');
            if (playerStateRef.current.isOpen && !path.includes('/watch')) { setPlayerState(p => ({ ...p, isOpen: false })); return; }
            if (path === '/' || path === '') { setCurrentView('home'); setSelectedMovie(null); }
            else if (path === '/toplist') setCurrentView('toplist');
            else if (path === '/trending') setCurrentView('trending');
            else if (path === '/api-docs') setCurrentView('api-docs');
            else if (path.startsWith('/search') && q) {
                setSearchState(prev => ({ ...prev, query: q, loading: true }));
                setCurrentView('search');
                const res = await ApiService.search(q, 1);
                setSearchState(prev => ({ ...prev, query: q, results: res.results, loading: false, hasMore: res.hasMore, nextPage: res.nextPage, loadingMore: false }));
            } else if (path.startsWith('/movie/') || path.startsWith('/tv/')) {
                let id = path.split('/').pop();
                if (id === 'watch' || id === 'undefined' || id === 'null' || !id || id === 'movie' || id === 'tv') {
                    const parts = path.split('/').filter(Boolean);
                    id = parts[parts.length - 2] || '';
                }
                if (id && id.length > 5) {
                    let foundInCategories = false;
                    for (const cat of categoriesDataRef.current) { const found = cat.movies?.find(m => m.subjectId === id); if (found) { setSelectedMovie(found); setCurrentView('details'); setLoadingDetails(true); try { const full = await ApiService.getDetails(found); setSelectedMovie(full); } catch {} setLoadingDetails(false); foundInCategories = true; break; } }
                    if (!foundInCategories) { setLoadingDetails(true); setCurrentView('details'); const movie = await ApiService.getMovieById(id); setSelectedMovie(movie); const full = await ApiService.getDetails(movie); setSelectedMovie(full); setLoadingDetails(false); }
                } else {
                    setCurrentView('home');
                    window.history.replaceState({}, '', '/');
                }
            }
        };
        window.addEventListener('popstate', handlePopState);
        const initCheck = async () => {
            const path = window.location.pathname;
            const q = new URLSearchParams(window.location.search).get('q');
            if (path === '/toplist') handleToplistClick();
            else if (path === '/trending') handleTrendingClick();
            else if (path === '/api-docs') setCurrentView('api-docs');
            else if (path.startsWith('/search') && q) handleSearch(q);
            else if (path.startsWith('/movie/') || path.startsWith('/tv/')) { const id = path.split('/').pop(); if (id) { setLoadingDetails(true); setCurrentView('details'); const movie = await ApiService.getMovieById(id); setSelectedMovie(movie); const full = await ApiService.getDetails(movie); setSelectedMovie(full); setLoadingDetails(false); } }
        };
        initCheck();
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    useEffect(() => {
        const init = async () => { 
            try {
                const trending = await ApiService.getTrendingSearches(); 
                setTrendingKeywords(trending); 
            } catch (e) {
                console.error('Error loading trending searches:', e);
            }
        };
        init();
    }, []);

    const handlePlayTrailer = () => { if (selectedMovie?.trailerUrl) { setPlayerState({ isOpen: true, title: `${selectedMovie.title} - Trailer`, sources: [{ quality: 720, stream: selectedMovie.trailerUrl, label: 'Trailer', type: 'mp4' }], subtitles: [], initialTime: 0, isTrailer: true, overlay: true }); window.history.pushState({}, '', window.location.pathname + '/trailer'); } };

    const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => { if (toast.timeoutId) clearTimeout(toast.timeoutId); const timeoutId = setTimeout(() => { setToast({ show: false, message: '', type: 'info' }); }, 3000); setToast({ show: true, message, type, timeoutId }); };

    const handleFetchSources = async (title: string, season = 1, episode = 1, subjectId?: string, detailPath?: string) => {
        const movie = selectedMovie;
        if (!movie) return;
        const activeSubjectId = (subjectId || movie.subjectId || '').trim();
        const activeDetailPath = (detailPath || movie.detailPath || '').trim();
        if (!activeSubjectId || activeSubjectId === 'undefined' || activeSubjectId === 'null') { showToast("Missing video ID. Go back and open details again.", "error"); return; }
        
        if (movie.type === 'Live Sport' && movie.sourceUrl) { setPlayerState({ isOpen: true, title, sources: [{ quality: 720, stream: movie.sourceUrl, label: 'Live Stream', type: 'hls' }], subtitles: [], subjectId: movie.subjectId, initialTime: 0, isLive: true }); window.history.pushState({}, '', window.location.pathname + '/watch'); return; }
        setLoadingSources(true);
        try {
            const data = await ApiService.getSources(activeSubjectId, movie.type, season, episode, activeDetailPath);
            if (data.videos && data.videos.length > 0) {
                setSourceModal({ isOpen: true, sources: data.videos, subtitles: data.subs || [], pendingContext: { title: movie.type.includes('Series') ? `${title} - S${season} E${episode}` : title, season, episode, initialTime: 0, subjectId: activeSubjectId, detailPath: activeDetailPath } });
            } else { showToast("No sources found. Try another movie.", "error"); }
        } catch (e) { console.error('[App] Source error:', e); showToast("Error loading sources", "error"); }
        finally { setLoadingSources(false); }
    };

    const handleTrendingClick = () => { setCurrentView('trending'); window.history.pushState({}, '', '/trending'); resetToHomeSEO(); if (trendingMovies.length === 0) loadTrending(0); };

    const handleLiveTvClick = () => { setCurrentView('live-tv'); window.history.pushState({}, '', '/live-tv'); resetToHomeSEO(); };


    const handleWebtoonClick = () => { setCurrentView('webtoon'); window.history.pushState({}, '', '/webtoon'); resetToHomeSEO(); };

    const handlePlayLiveChannel = (channel: any) => {
        if (!channel) return;
        const rawUrl = channel.stream_url || channel.url || channel.streamUrl;
        if (!rawUrl) return;
        
        const streamUrl = rawUrl;
        
        const isMp4 = streamUrl.toLowerCase().includes('.mp4') || (channel.format === 'mp4');
        const streamType = isMp4 ? 'mp4' : 'hls';
        
        setPlayerState({ 
            isOpen: true, 
            title: channel.name || channel.title || 'Live Stream', 
            sources: [{ quality: 720, stream: streamUrl, label: 'Live Stream', type: streamType }], 
            subtitles: [], 
            initialTime: 0, 
            isLive: true 
        });
        if (!window.location.pathname.includes('/watch')) {
            window.history.pushState({}, '', window.location.pathname + '/watch');
        }
    };

    const handlePlayHighlight = (highlight: any) => {
        handlePlayLiveChannel({
            id: highlight.id,
            url: highlight.path,
            title: highlight.title
        });
    };

    const handlePlaySports = (match: any) => {
        handlePlayLiveChannel({
            id: match.id,
            url: match.playPath,
            title: match.team1.name + ' vs ' + match.team2.name
        });
    };

    const handleReadWebtoon = (url: string, title: string) => {
        setReaderState({ isOpen: true, url, title });
        setCurrentView('webtoon-reader');
        window.history.pushState({}, '', '/webtoon/read');
    };

    const handleProgressUpdate = (time: number, duration: number) => {
        if (!playerState.subjectId || !playerState.season || !playerState.episode) return;
        
        if (duration > 0 && time > 0) {
            const progress = (time / duration) * 100;
            const isCompleted = progress > 90;
            
            const key = `slflix_progress_${playerState.subjectId}`;
            const stored = localStorage.getItem(key);
            const data = stored ? JSON.parse(stored) : {};
            
            const epKey = `S${playerState.season}E${playerState.episode}`;
            data[epKey] = {
                progress,
                completed: isCompleted,
                time,
                duration
            };
            
            localStorage.setItem(key, JSON.stringify(data));
            window.dispatchEvent(new Event('slflix_progress_update'));
        }
    };

    return (
        <div className="bg-[#0a0a15] min-h-screen text-white font-sans overflow-x-hidden flex flex-col">
            <Toast {...toast} />
            {(loadingSources) && <LoadingView />}
            <SourceSelector 
                isOpen={sourceModal.isOpen} 
                sources={sourceModal.sources} 
                subtitles={sourceModal.subtitles}
                onClose={() => setSourceModal({ isOpen: false, sources: [], subtitles: [] })} 
                onSelect={(s) => {
                    if (sourceModal.pendingContext) {
                        const { title, season, episode, initialTime, subjectId } = sourceModal.pendingContext;
                        let nextEp = undefined;
                        if (selectedMovie?.type.includes('Series')) { const currentSeason = selectedMovie.seasons?.find(s => s.seasonNumber === season); if (currentSeason && episode < currentSeason.episodeCount) nextEp = { season, episode: episode + 1, title: selectedMovie.title }; }
                        setPlayerState({ isOpen: true, title, sources: [s, ...sourceModal.sources.filter(x => x !== s)], subtitles: sourceModal.subtitles, subjectId, season, episode, initialTime, nextEpisode: nextEp });
                        if (!window.location.pathname.includes('/watch')) {
                            window.history.pushState({}, '', window.location.pathname + '/watch');
                        } else {
                            window.history.replaceState({}, '', window.location.pathname);
                        }
                    }
                    setSourceModal({ isOpen: false, sources: [], subtitles: [] });
                }}
                onToast={(m) => showToast(m, 'success')} 
            />

            {playerState.isOpen && (
                <VideoPlayer 
                    {...playerState} 
                    onClose={() => { 
                        const currentPath = window.location.pathname;
                        const newPath = currentPath.replace('/watch', '').replace('/trailer', '');
                        setPlayerState(p => ({ ...p, isOpen: false })); 
                        window.history.replaceState({}, '', newPath);
                    }}
                    onProgressUpdate={handleProgressUpdate}
                    onPlayNext={() => { if (playerState.nextEpisode) { setPlayerState(p => ({ ...p, isOpen: false })); const currentPath = window.location.pathname.replace('/watch', '').replace('/trailer', ''); window.history.replaceState({}, '', currentPath); setTimeout(() => handleFetchSources(playerState.nextEpisode!.title, playerState.nextEpisode!.season, playerState.nextEpisode!.episode), 300); } }}
                />
            )}

            <div className={playerState.isOpen ? 'hidden' : 'block'}>
                <Navbar 
                    onSearch={handleSearch} 
                    onHome={() => { setCurrentView('home'); window.history.pushState({}, '', '/'); resetToHomeSEO(); }} 
                    onToplist={() => handleToplistClick()} 
                    onLiveTv={handleLiveTvClick}
                    onNews={() => { setCurrentView('news'); window.history.pushState({}, '', '/news'); resetToHomeSEO(); }}
                    onWebtoon={handleWebtoonClick}
                    isSearchOpen={isSearchOpen} 
                    setIsSearchOpen={setIsSearchOpen} 
                    trendingKeywords={trendingKeywords} 
                    currentView={currentView}
                />
                <main className="flex-1">
                    {currentView === 'home' && (
                        <div className="pb-24">
                            <HomePage heroMovies={heroMovies} categoriesData={categoriesData} onMovieClick={handleMovieClick} onToplistClick={handleToplistClick} loading={homeLoading} />
                        </div>
                    )}
                    {currentView === 'search' && (
                        <div className="pt-8 px-[4%] pb-24">
                            <div className="mb-6"><h2 className="text-2xl font-bold text-white">Search Results</h2><p className="text-gray-400 text-sm mt-1">Found {searchState.results.length} results for "{searchState.query}"</p></div>
                            {searchState.loading ? <Loader /> : (
                                <>
                                    {searchState.results.length > 0 ? (
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                                            {searchState.results.map((m, i) => (
                                                <div key={i} className="transform transition-all duration-300 hover:scale-105 hover:z-10">
                                                    <MovieCard movie={m} onClick={handleMovieClick} />
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="col-span-full text-center py-20">
                                            <div className="text-6xl mb-4 text-gray-600"><i className="fa-solid fa-film"></i></div>
                                            <p className="text-gray-400 text-lg">No results found</p>
                                        </div>
                                    )}
                                    <div ref={searchLoadMoreRef} className="flex justify-center py-8">
                                        {searchState.loadingMore && <Loader type="circle" inline />}
                                        {!searchState.hasMore && searchState.results.length > 0 && (
                                            <p className="text-gray-500 text-xs uppercase tracking-wider font-bold">No more results</p>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                    {currentView === 'trending' && <TrendingView movies={trendingMovies} loading={trendingLoading} hasMore={trendingHasMore} onLoadMore={() => loadTrending(trendingPage + 1)} onMovieClick={handleMovieClick} />}
                    {currentView === 'toplist' && <ToplistView initialCategory={toplistCategory} onMovieClick={handleMovieClick} onBack={() => { setCurrentView('home'); window.history.pushState({}, '', '/'); }} />}
                    {currentView === 'live-tv' && <LiveTv onBack={() => { setCurrentView('home'); window.history.pushState({}, '', '/'); }} onPlay={handlePlayLiveChannel} />}
                    {currentView === 'news' && <NewsView onPlayMatch={handlePlaySports} onPlayHighlight={handlePlayHighlight} />}
                    {currentView === 'webtoon' && <WebtoonView onBack={() => { setCurrentView('home'); window.history.pushState({}, '', '/'); }} onRead={handleReadWebtoon} />}
                    {currentView === 'webtoon-reader' && <WebtoonReader url={readerState.url} title={readerState.title} onBack={() => { setCurrentView('webtoon'); window.history.back(); }} />}
                    {currentView === 'api-docs' && <ApiDocsView />}
                    {currentView === 'details' && selectedMovie && <DetailsView movie={selectedMovie} onBack={() => window.history.back()} onFetchSources={handleFetchSources} onPlayTrailer={handlePlayTrailer} onMovieClick={handleMovieClick} onDubClick={(d) => handleMovieClick({ title: "...", cover: "", thumbnail: "", type: selectedMovie.type, subjectId: d.subjectId, detailPath: d.detailPath })} loading={loadingDetails} />}
                </main>
                <Footer />
                <div className="fixed bottom-4 left-0 w-full flex justify-center z-50 pointer-events-none px-4">
                    <div className="pointer-events-auto">
                        <Dock magnification={60} distance={100} panelHeight={60} className="bg-[#141414]/95 border-white/10 shadow-2xl">
                            <DockItem onClick={() => { setCurrentView("home"); window.history.pushState({}, "", "/"); resetToHomeSEO(); }}>
                                <DockLabel>Home</DockLabel>
                                <DockIcon><i className={`fa-solid fa-house text-xl ${currentView === "home" ? "text-primary drop-shadow-[0_0_8px_rgba(0,229,255,0.8)]" : "text-gray-400"}`}></i></DockIcon>
                            </DockItem>
                            <DockItem onClick={() => handleLiveTvClick()}>
                                <DockLabel>Live TV</DockLabel>
                                <DockIcon><i className={`fa-solid fa-satellite-dish text-xl ${currentView === "live-tv" ? "text-primary drop-shadow-[0_0_8px_rgba(0,229,255,0.8)]" : "text-gray-400"}`}></i></DockIcon>
                            </DockItem>
                            <DockItem onClick={() => { setCurrentView("news"); window.history.pushState({}, "", "/news"); }}>
                                <DockLabel>News</DockLabel>
                                <DockIcon><i className={`fa-solid fa-newspaper text-xl ${currentView === "news" ? "text-primary drop-shadow-[0_0_8px_rgba(0,229,255,0.8)]" : "text-gray-400"}`}></i></DockIcon>
                            </DockItem>
                            <DockItem onClick={() => handleWebtoonClick()}>
                                <DockLabel>Toon</DockLabel>
                                <DockIcon><i className={`fa-solid fa-book-open text-xl ${currentView === "webtoon" ? "text-primary drop-shadow-[0_0_8px_rgba(0,229,255,0.8)]" : "text-gray-400"}`}></i></DockIcon>
                            </DockItem>
                            <DockItem onClick={() => handleTrendingClick()}>
                                <DockLabel>Trending</DockLabel>
                                <DockIcon><i className={`fa-solid fa-fire text-xl ${currentView === "trending" ? "text-primary drop-shadow-[0_0_8px_rgba(0,229,255,0.8)]" : "text-gray-400"}`}></i></DockIcon>
                            </DockItem>
                            <DockItem onClick={() => setIsSearchOpen(true)}>
                                <DockLabel>Search</DockLabel>
                                <DockIcon><i className="fa-solid fa-search text-xl text-gray-400"></i></DockIcon>
                            </DockItem>
                        </Dock>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default App;

