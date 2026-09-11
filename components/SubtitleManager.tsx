import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Subtitle } from '../types';
interface SubtitleManagerProps {
  videoElement: HTMLVideoElement | null;
  subtitles: Subtitle[];
  onSubtitleChange?: (index: number) => void;
  className?: string;
  activeSubtitle?: number;
}
const LANGUAGE_NAMES: Record<string, string> = {
  'en': 'English',
  'es': 'Español',
  'fr': 'Français',
  'de': 'Deutsch',
  'it': 'Italiano',
  'pt': 'Português',
  'zh': '中文',
  'ja': '日本語',
  'ko': '한국어',
  'ar': 'العربية',
  'hi': 'हिन्दी',
  'ru': 'Русский',
  'tr': 'Türkçe',
  'th': 'ไทย',
  'vi': 'Tiếng Việt',
  'id': 'Bahasa Indonesia',
  'ms': 'Bahasa Melayu',
  'tl': 'Filipino',
  'bn': 'বাংলা',
  'ta': 'தமிழ்',
  'te': 'తెలుగు',
  'ml': 'മലയാളം',
  'pa': 'ਪੰਜਾਬੀ',
  'uk': 'Українська',
  'pl': 'Polski',
  'nl': 'Nederlands',
  'sv': 'Svenska',
  'da': 'Dansk',
  'no': 'Norsk',
  'fi': 'Suomi',
  'el': 'Ελληνικά',
  'he': 'עברית',
  'cs': 'Čeština',
  'hu': 'Magyar',
  'ro': 'Română',
  'bg': 'Български',
  'sr': 'Српски',
  'hr': 'Hrvatski',
  'sk': 'Slovenčina',
  'sl': 'Slovenščina',
  'lt': 'Lietuvių',
  'lv': 'Latviešu',
  'et': 'Eesti',
};
export const getLanguageName = (code: string): string => {
  return LANGUAGE_NAMES[code?.toLowerCase()] || code || 'Unknown';
};
export const detectUserLanguage = (): string => {
  try {
    const browserLang = navigator.language || 'en';
    const langCode = browserLang.split('-')[0].toLowerCase();
    return langCode || 'en';
  } catch {
    return 'en';
  }
};
export const findBestSubtitle = (subtitles: Subtitle[], userLang?: string): number => {
  if (!subtitles || subtitles.length === 0) return -1;
  const lang = userLang || detectUserLanguage();
  const exactMatch = subtitles.findIndex(
    sub => sub.lang?.toLowerCase() === lang || sub.language?.toLowerCase() === lang
  );
  if (exactMatch >= 0) return exactMatch;
  const startsWithMatch = subtitles.findIndex(
    sub => sub.lang?.toLowerCase().startsWith(lang) || sub.language?.toLowerCase().startsWith(lang)
  );
  if (startsWithMatch >= 0) return startsWithMatch;
  const englishMatch = subtitles.findIndex(
    sub => sub.lang?.toLowerCase() === 'en' || sub.language?.toLowerCase() === 'english'
  );
  if (englishMatch >= 0) return englishMatch;
  return 0;
};
const SubtitleManager: React.FC<SubtitleManagerProps> = ({
  videoElement,
  subtitles = [],
  onSubtitleChange,
  className = '',
  activeSubtitle: externalActiveSubtitle
}) => {
  const [internalActiveSubtitle, setInternalActiveSubtitle] = useState<number>(-1);
  const activeSubtitle = externalActiveSubtitle !== undefined ? externalActiveSubtitle : internalActiveSubtitle;
  const setActiveSubtitle = (index: number) => {
      setInternalActiveSubtitle(index);
      onSubtitleChange?.(index);
  }
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tracksInjected, setTracksInjected] = useState(false);
  const retryCountRef = useRef(0);
  const maxRetries = 3;
  useEffect(() => {
    if (subtitles.length > 0 && activeSubtitle === -1) {
      const bestSubtitle = findBestSubtitle(subtitles);
      if (bestSubtitle >= 0) {
        setActiveSubtitle(bestSubtitle);
      }
    }
  }, [subtitles]);
  useEffect(() => {
    if (!videoElement || subtitles.length === 0) return;
    const injectTracks = () => {
      setIsLoading(true);
      setError(null);
      try {
        const existingTracks = videoElement.querySelectorAll('track');
        existingTracks.forEach(track => track.remove());
        subtitles.forEach((sub, index) => {
          const track = document.createElement('track');
          track.kind = 'subtitles';
          track.label = sub.name || getLanguageName(sub.lang || sub.language || 'en');
          track.srclang = sub.lang || sub.language || 'en';
          track.id = index.toString();
          if (sub.url) {
            track.src = sub.url;
          } else {
            const blob = new Blob(['WEBVTT\n\n'], { type: 'text/vtt' });
            track.src = URL.createObjectURL(blob);
          }
          track.default = index === activeSubtitle;
          track.onerror = () => {
            if (!sub.url) return; 
            console.warn(`[SubtitleManager] Failed to load subtitle: ${sub.url}`);
            retryCountRef.current++;
            if (retryCountRef.current < maxRetries) {
              setTimeout(injectTracks, 1000 * retryCountRef.current);
            } else {
              setError('Failed to load subtitle');
              setIsLoading(false);
            }
          };
          track.onload = () => {
            setTracksInjected(true);
            setIsLoading(false);
            retryCountRef.current = 0;
            if (index === activeSubtitle && videoElement.textTracks) {
              for (let i = 0; i < videoElement.textTracks.length; i++) {
                if (videoElement.textTracks[i].id === index.toString()) {
                  videoElement.textTracks[i].mode = 'showing';
                }
              }
            }
          };
          videoElement.appendChild(track);
        });
      } catch (err) {
        console.error('[SubtitleManager] Error injecting tracks:', err);
        setError('Failed to initialize subtitles');
        setIsLoading(false);
      }
    };
    if (videoElement.readyState >= 1) {
      injectTracks();
    } else {
      videoElement.addEventListener('loadedmetadata', injectTracks, { once: true });
    }
    return () => {
      const existingTracks = videoElement.querySelectorAll('track');
      existingTracks.forEach(track => track.remove());
    };
  }, [videoElement, subtitles]);
  useEffect(() => {
    if (!videoElement || !tracksInjected) return;
    const tracks = videoElement.textTracks;
    if (!tracks) return;
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].mode = (tracks[i].id === activeSubtitle.toString()) ? 'showing' : 'hidden';
    }
    onSubtitleChange?.(activeSubtitle);
  }, [activeSubtitle, videoElement, tracksInjected, onSubtitleChange]);
  const handleSubtitleSelect = useCallback((index: number) => {
    setActiveSubtitle(index);
    setIsOpen(false);
    setError(null);
    retryCountRef.current = 0;
  }, []);
  const handleToggle = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);
  const getActiveSubtitleName = (): string => {
    if (activeSubtitle < 0) return 'Off';
    const sub = subtitles[activeSubtitle];
    return sub?.name || getLanguageName(sub?.lang || sub?.language || 'en');
  };
  if (subtitles.length === 0) {
    return null;
  }
  return (
    <div className={`relative ${className}`}>
      {}
      <button
        onClick={handleToggle}
        className={`
          flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium
          transition-all duration-200
          ${activeSubtitle >= 0 
            ? 'bg-primary text-black shadow-lg shadow-primary/30' 
            : 'bg-white/10 text-white hover:bg-white/20'
          }
        `}
        title={activeSubtitle >= 0 ? 'Subtitles On' : 'Subtitles Off'}
      >
        <svg 
          className="w-4 h-4" 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={2} 
            d="M4 6h16M4 10h16M4 14h16M4 18h16" 
          />
        </svg>
        <span>{getActiveSubtitleName()}</span>
      </button>
      {}
      {isOpen && (
        <div className="absolute bottom-full mb-2 right-0 w-64 bg-[#1a1a2e] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50 animate-fade-in">
          {}
          <div className="px-4 py-3 border-b border-white/10">
            <h3 className="text-white font-semibold text-sm">Subtitles</h3>
          </div>
          {}
          <div className="max-h-64 overflow-y-auto">
            {}
            <button
              onClick={() => handleSubtitleSelect(-1)}
              className={`
                w-full px-4 py-3 text-left flex items-center justify-between
                transition-colors hover:bg-white/5
                ${activeSubtitle === -1 ? 'text-primary' : 'text-gray-300'}
              `}
            >
              <span>Off</span>
              {activeSubtitle === -1 && (
                <svg className="w-4 h-4 text-primary" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
            {}
            {subtitles.map((sub, index) => (
              <button
                key={index}
                onClick={() => handleSubtitleSelect(index)}
                className={`
                  w-full px-4 py-3 text-left flex items-center justify-between
                  transition-colors hover:bg-white/5
                  ${activeSubtitle === index ? 'text-primary' : 'text-gray-300'}
                `}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs uppercase text-gray-500 w-6">
                    {sub.lang?.slice(0, 2) || sub.language?.slice(0, 2) || 'N/A'}
                  </span>
                  <span>{sub.name || getLanguageName(sub.lang || sub.language || 'en')}</span>
                </div>
                {activeSubtitle === index && (
                  <svg className="w-4 h-4 text-primary" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            ))}
          </div>
          {}
          {error && (
            <div className="px-4 py-2 bg-red-500/20 text-red-400 text-xs">
              {error}
            </div>
          )}
          {}
          {isLoading && (
            <div className="px-4 py-2 bg-primary/20 text-primary text-xs flex items-center gap-2">
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading subtitles...
            </div>
          )}
        </div>
      )}
    </div>
  );
};
export const SubtitleToggle: React.FC<{
  isActive: boolean;
  onClick: () => void;
  label?: string;
}> = ({ isActive, onClick, label = 'CC' }) => (
  <button
    onClick={onClick}
    className={`
      w-9 h-9 flex items-center justify-center rounded-lg
      transition-all duration-200
      ${isActive 
        ? 'bg-primary text-black shadow-lg shadow-primary/30' 
        : 'bg-white/10 text-white hover:bg-white/20'
      }
    `}
    title={isActive ? 'Subtitles On' : 'Subtitles Off'}
  >
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    </svg>
    {label && <span className="ml-1 text-xs">{label}</span>}
  </button>
);
export default SubtitleManager;