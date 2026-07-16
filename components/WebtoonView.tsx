import React, { useState, useEffect } from 'react';
import { ApiService } from '../services/api';
import { WebtoonItem, WebtoonDetail } from '../types';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import { ArrowLeft, Search, X, ChevronRight, TrendingUp, BookOpen, Clock, Tag } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface WebtoonViewProps {
  onBack: () => void;
  onRead: (url: string, title: string) => void;
}

const WebtoonView: React.FC<WebtoonViewProps> = ({ onBack, onRead }) => {
// ... existing state ...
  const [trending, setTrending] = useState<WebtoonItem[]>([]);
  const [results, setResults] = useState<WebtoonItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedWebtoon, setSelectedWebtoon] = useState<WebtoonDetail | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    const fetchHome = async () => {
      setLoading(true);
      const data = await ApiService.getWebtoonHome();
      setTrending(data.trending || []);
      setLoading(false);
    };
    fetchHome();
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query) return;
    setLoading(true);
    const data = await ApiService.searchWebtoon(query);
    setResults(data.results || []);
    setLoading(false);
  };

  const handleWebtoonClick = async (item: WebtoonItem) => {
    setDetailLoading(true);
    setShowDetail(true);
    const detail = await ApiService.getWebtoonDetail(item.url);
    setSelectedWebtoon(detail);
    setDetailLoading(false);
  };

  return (
    <div className="p-4 md:p-8 pt-8 md:pt-12 animate-fade-in min-h-screen bg-[#050510]">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
          <div className="flex items-center gap-5">
            <motion.button 
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={onBack} 
              className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white hover:bg-primary hover:text-black transition-all shadow-xl"
            >
              <ArrowLeft size={20} />
            </motion.button>
            <div>
              <h2 className="text-4xl font-black text-white flex items-center gap-3 italic tracking-tighter">
                <span className="text-primary">WEB</span>
                <span className="bg-primary text-black px-3 py-1 rounded-xl">TOON</span>
              </h2>
              <p className="text-gray-500 text-xs font-bold mt-1 uppercase tracking-widest flex items-center gap-2">
                <BookOpen size={12} className="text-primary" />
                Immersive Digital Comics
              </p>
            </div>
          </div>

          <form onSubmit={handleSearch} className="relative flex-1 max-w-md group">
            <input 
              type="text" 
              placeholder="Search infinite stories..." 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-white/5 border-2 border-white/5 rounded-2xl py-4 px-12 text-white placeholder:text-gray-600 focus:border-primary/50 focus:bg-white/10 outline-none transition-all shadow-2xl"
            />
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-primary transition-colors" size={20} />
            {query && (
              <button type="button" onClick={() => {setQuery(''); setResults([]);}} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                <X size={16} />
              </button>
            )}
          </form>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-40">
            <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-gray-500 font-bold text-xs uppercase tracking-widest animate-pulse">Summoning Comics...</p>
          </div>
        ) : (
          <div className="space-y-16">
            <AnimatePresence mode="wait">
              {results.length > 0 ? (
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
                  <div className="flex items-center gap-3 mb-8">
                    <div className="w-2 h-8 bg-primary rounded-full"></div>
                    <h3 className="text-2xl font-black text-white">Found for <span className="text-primary">"{query}"</span></h3>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
                    {results.map((item, i) => (
                      <WebtoonCard key={item.titleNo} item={item} i={i} onClick={() => handleWebtoonClick(item)} />
                    ))}
                  </div>
                </motion.div>
              ) : (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                      <TrendingUp className="text-primary" size={24} />
                      <h3 className="text-2xl font-black text-white">Trending Now</h3>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-8">
                    {trending.map((item, i) => (
                      <WebtoonCard key={item.titleNo} item={item} i={i} onClick={() => handleWebtoonClick(item)} />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showDetail && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-3xl flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="w-full max-w-5xl bg-[#0a0a1a] md:border md:border-white/10 md:rounded-[3rem] overflow-hidden shadow-[0_0_100px_rgba(0,0,0,0.5)] relative h-full md:h-auto md:max-h-[90vh] flex flex-col md:flex-row"
            >
              <button 
                onClick={() => setShowDetail(false)} 
                className="absolute top-4 right-4 md:top-6 md:right-6 w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-black/40 hover:bg-red-500/80 hover:text-white flex items-center justify-center text-white z-20 transition-all backdrop-blur-md border border-white/20 shadow-xl"
              >
                <X size={20} />
              </button>
              
              {detailLoading ? (
                <div className="flex-1 flex flex-col items-center justify-center py-40">
                  <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
                  <p className="text-gray-500 text-[10px] font-bold tracking-[0.2em] uppercase">Unfolding Pages...</p>
                </div>
              ) : selectedWebtoon && (
                <>
                  <div className="w-full h-[40vh] md:h-auto md:w-2/5 relative flex-shrink-0">
                    <img src={selectedWebtoon.thumbnail} referrerPolicy="no-referrer" className="w-full h-full object-cover" alt="" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a1a] via-[#0a0a1a]/60 to-transparent md:bg-gradient-to-r md:from-transparent md:to-[#0a0a1a]"></div>
                  </div>
                  <div className="flex-1 p-6 md:p-12 overflow-y-auto scrollbar-hide bg-[#0a0a1a] -mt-10 md:mt-0 relative z-10">
                    <div className="mb-8">
                      <h3 className="text-4xl font-black text-white mb-3 leading-tight tracking-tight">{selectedWebtoon.title}</h3>
                      <p className="text-primary font-bold text-sm flex items-center gap-2">
                        <span className="w-5 h-[2px] bg-primary"></span>
                        {selectedWebtoon.authors.join(', ')}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2 mb-8">
                      {selectedWebtoon.tags.map(tag => (
                        <span key={tag} className="bg-white/5 px-4 py-1.5 rounded-xl text-[10px] font-bold text-gray-400 border border-white/10 flex items-center gap-2 uppercase tracking-widest">
                          <Tag size={10} className="text-primary" />
                          {tag}
                        </span>
                      ))}
                      <span className="bg-primary/20 text-primary px-4 py-1.5 rounded-xl text-[10px] font-black border border-primary/20 uppercase tracking-widest flex items-center gap-2">
                        <TrendingUp size={10} />
                        {selectedWebtoon.ranking}
                      </span>
                    </div>

                    <div className="relative mb-12">
                       <p className="text-gray-400 text-sm leading-relaxed">{selectedWebtoon.summary}</p>
                    </div>
                    
                    <div className="space-y-4">
                      <div className="flex items-center justify-between mb-6">
                        <h4 className="text-white font-black text-xl flex items-center gap-2 italic">
                          <BookOpen size={20} className="text-primary" />
                          EPISODES
                        </h4>
                        <span className="text-[10px] font-bold text-gray-600 tracking-widest">{selectedWebtoon.episodes.length} CHAPTERS</span>
                      </div>
                      <div className="grid grid-cols-1 gap-3">
                        {selectedWebtoon.episodes.map((ep, idx) => (
                          <motion.button 
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.05 }}
                            key={ep.episodeNo}
                            onClick={() => onRead(ep.url, `${selectedWebtoon.title} - ${ep.title}`)}
                            className="group/ep w-full flex items-center gap-5 p-4 bg-white/5 rounded-3xl border border-white/5 hover:border-primary/30 hover:bg-white/10 transition-all text-left"
                          >
                            <div className="w-16 h-16 rounded-2xl overflow-hidden flex-shrink-0 relative">
                              <img src={ep.thumbnail} referrerPolicy="no-referrer" className="w-full h-full object-cover group-hover/ep:scale-110 transition-transform duration-500" alt="" />
                              <div className="absolute inset-0 bg-primary/20 opacity-0 group-hover/ep:opacity-100 transition-opacity"></div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-white font-black group-hover/ep:text-primary transition-colors truncate">{ep.title}</p>
                              <div className="flex items-center gap-3 mt-1.5">
                                <span className="text-[10px] font-bold text-primary/60 uppercase tracking-widest bg-primary/10 px-2 py-0.5 rounded-lg">Episode {ep.episodeNo}</span>
                                <span className="text-[10px] text-gray-600 font-medium flex items-center gap-1">
                                  <Clock size={8} />
                                  {new Date(ep.date).toLocaleDateString()}
                                </span>
                              </div>
                            </div>
                            <div className="w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center text-gray-700 group-hover/ep:text-primary group-hover/ep:bg-primary/10 transition-all">
                              <ChevronRight size={18} />
                            </div>
                          </motion.button>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const WebtoonCard = ({ item, onClick, i }: { item: WebtoonItem, onClick: () => void, i: number }) => (
  <motion.div 
    initial={{ opacity: 0, scale: 0.9 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ delay: i * 0.05 }}
    onClick={onClick} 
    className="group cursor-pointer"
  >
    <div className="relative aspect-[3/4] rounded-[2rem] overflow-hidden bg-white/5 border border-white/10 group-hover:border-primary/50 transition-all shadow-2xl group-hover:-translate-y-2 duration-500">
      <LazyLoadImage 
        src={item.thumbnail} 
        alt={item.title} 
        effect="blur" referrerPolicy="no-referrer" 
        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" 
      />
      
      {/* Genre Badge */}
      <div className="absolute top-4 left-4 z-20">
        <span className="bg-black/60 backdrop-blur-md text-primary text-[9px] font-black px-3 py-1.5 rounded-xl border border-white/10 uppercase tracking-widest shadow-xl">
          {item.genre}
        </span>
      </div>

      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent opacity-80 group-hover:opacity-100 transition-opacity"></div>
      
      <div className="absolute bottom-0 left-0 right-0 p-6 translate-y-2 group-hover:translate-y-0 transition-transform duration-500">
        <h4 className="text-white text-sm font-black leading-tight group-hover:text-primary transition-colors line-clamp-2">{item.title}</h4>
        {item.rank && (
          <div className="flex items-center gap-2 mt-2">
            <div className="w-4 h-4 rounded-full bg-primary flex items-center justify-center">
              <TrendingUp size={8} className="text-black" />
            </div>
            <p className="text-[10px] text-primary font-black uppercase tracking-widest">RANK {item.rank}</p>
          </div>
        )}
      </div>

      {/* Hover Play Button Icon (Eye) */}
      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        <div className="w-16 h-16 rounded-full bg-primary/20 backdrop-blur-md border border-primary/50 flex items-center justify-center text-primary scale-50 group-hover:scale-100 transition-transform duration-500">
          <BookOpen size={24} />
        </div>
      </div>
    </div>
  </motion.div>
);

export default WebtoonView;
