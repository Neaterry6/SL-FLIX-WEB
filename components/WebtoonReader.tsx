import React, { useState, useEffect } from 'react';
import { ApiService } from '../services/api';
import { WebtoonRead } from '../types';
import { ArrowLeft, Maximize, Minimize, ChevronUp, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
interface WebtoonReaderProps {
  url: string;
  title: string;
  onBack: () => void;
}
const WebtoonReader: React.FC<WebtoonReaderProps> = ({ url, title, onBack }) => {
  const [data, setData] = useState<WebtoonRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [isFullWidth, setIsFullWidth] = useState(false);
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const result = await ApiService.readWebtoon(url);
        setData(result);
      } catch (err) {
        setError('Failed to load episode. The dark side is strong here...');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
    const timer = setTimeout(() => setShowControls(false), 3000);
    return () => clearTimeout(timer);
  }, [url]);
  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  if (loading) {
    return (
      <div className="fixed inset-0 z-[300] bg-black flex flex-col items-center justify-center">
        <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mb-6"></div>
        <h2 className="text-white font-black text-xl tracking-tighter italic animate-pulse">PREPARING YOUR STORY</h2>
      </div>
    );
  }
  if (error) {
    return (
      <div className="fixed inset-0 z-[300] bg-black flex flex-col items-center justify-center p-6 text-center">
        <div className="text-red-500 mb-6 text-6xl">💀</div>
        <h2 className="text-white font-black text-2xl mb-4">{error}</h2>
        <button 
          onClick={onBack}
          className="bg-primary text-black font-black px-8 py-3 rounded-2xl hover:scale-105 transition-transform"
        >
          GET ME OUT OF HERE
        </button>
      </div>
    );
  }
  return (
    <div 
      className="fixed inset-0 z-[300] bg-[#050505] overflow-y-auto scrollbar-hide select-none"
      onMouseMove={() => {
        setShowControls(true);
      }}
    >
      {}
      <AnimatePresence>
        {showControls && (
          <motion.div 
            initial={{ y: -100 }}
            animate={{ y: 0 }}
            exit={{ y: -100 }}
            className="fixed top-0 left-0 right-0 z-[310] bg-black/80 backdrop-blur-xl border-b border-white/5 p-4 md:px-8 flex items-center justify-between"
          >
            <div className="flex items-center gap-4">
              <button 
                onClick={onBack}
                className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-white hover:bg-primary hover:text-black transition-all"
              >
                <ArrowLeft size={20} />
              </button>
              <h2 className="text-white font-bold text-sm md:text-base truncate max-w-[200px] md:max-w-md uppercase tracking-tight">
                {title}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setIsFullWidth(!isFullWidth)}
                className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-white hover:bg-white/10"
                title={isFullWidth ? "Center View" : "Full Width"}
              >
                {isFullWidth ? <Minimize size={18} /> : <Maximize size={18} />}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {}
      <div className={`mx-auto transition-all duration-500 ${isFullWidth ? 'w-full' : 'max-w-3xl border-x border-white/5'}`}>
        {data?.images.map((img, idx) => (
          <div key={idx} className="relative bg-black/20" style={{ minHeight: '200px' }}>
            <img 
              src={img.url ? `/api/tv/img?url=${encodeURIComponent(img.url)}` : ''} 
              alt=""
              className="w-full h-auto block"
              loading={idx < 3 ? "eager" : "lazy"}
              referrerPolicy="no-referrer"
              onContextMenu={(e) => e.preventDefault()}
              draggable={false}
            />
          </div>
        ))}
        {}
        <div className="py-20 text-center bg-black/40">
            <div className="w-20 h-[2px] bg-primary/30 mx-auto mb-8"></div>
            <h3 className="text-white/40 font-black text-xl tracking-widest uppercase">Chapter Completed</h3>
            <button 
              onClick={onBack}
              className="mt-12 group flex items-center gap-4 mx-auto bg-white/5 px-10 py-5 rounded-3xl border border-white/10 hover:border-primary hover:bg-primary/10 transition-all"
            >
              <ArrowLeft className="group-hover:-translate-x-2 transition-transform" />
              <span className="text-white font-black group-hover:text-primary">BACK TO DETAIL</span>
            </button>
        </div>
      </div>
      {}
      <AnimatePresence>
        {showControls && (
          <motion.div 
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[310] flex items-center gap-3 bg-black/60 backdrop-blur-2xl p-2 rounded-2xl border border-white/10 shadow-2xl"
          >
            <button 
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-white hover:text-primary transition-colors"
            >
              <ChevronUp size={24} />
            </button>
            <button 
              onClick={() => window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' })}
              className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-white hover:text-primary transition-colors"
            >
              <ChevronDown size={24} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
export default WebtoonReader;