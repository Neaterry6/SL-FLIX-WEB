import React, { useState } from 'react';
import { Subtitle } from '../types';
import { getLanguageName } from './SubtitleManager';

export interface AudioTrackItem {
  id: number;
  name: string;
  lang?: string;
}

interface AudioSubtitleModalProps {
  isOpen: boolean;
  onClose: () => void;
  subtitles: Subtitle[];
  activeSubtitle: number;
  onSubtitleChange: (index: number) => void;
  subtitleOffset: number;
  onSubtitleOffsetChange: (offset: number) => void;
  subtitleFontSize: 'small' | 'medium' | 'large';
  onSubtitleFontSizeChange: (size: 'small' | 'medium' | 'large') => void;
  audioTracks: AudioTrackItem[];
  activeAudioTrack: number;
  onAudioTrackChange: (index: number) => void;
}

export const AudioSubtitleModal: React.FC<AudioSubtitleModalProps> = ({
  isOpen,
  onClose,
  subtitles,
  activeSubtitle,
  onSubtitleChange,
  subtitleOffset,
  onSubtitleOffsetChange,
  subtitleFontSize,
  onSubtitleFontSizeChange,
  audioTracks,
  activeAudioTrack,
  onAudioTrackChange
}) => {
  const [activeTab, setActiveTab] = useState<'subtitles' | 'audio'>('subtitles');
  const [searchQuery, setSearchQuery] = useState('');

  if (!isOpen) return null;

  const filteredSubtitles = subtitles.map((sub, index) => ({ sub, index })).filter(({ sub }) => {
    if (!searchQuery.trim()) return true;
    const name = (sub.name || getLanguageName(sub.lang || sub.language || '')).toLowerCase();
    const lang = (sub.lang || sub.languageCode || '').toLowerCase();
    const q = searchQuery.toLowerCase().trim();
    return name.includes(q) || lang.includes(q);
  });

  return (
    <div 
      className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div 
        className="bg-[#12121a] border border-white/10 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[85vh] transition-all transform scale-100"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex justify-between items-center bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <i className="fa-solid fa-sliders text-sm"></i>
            </div>
            <div>
              <h3 className="text-base font-black text-white tracking-tight">Audio & Subtitles</h3>
              <p className="text-gray-400 text-[11px]">Stream preferences and customization</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
          >
            <i className="fa-solid fa-times text-sm"></i>
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-white/10 bg-black/20 p-1.5 gap-1.5 mx-4 mt-4 rounded-xl">
          <button
            onClick={() => setActiveTab('subtitles')}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              activeTab === 'subtitles' 
                ? 'bg-primary text-black shadow-lg shadow-primary/20' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <i className="fa-solid fa-closed-captioning"></i>
            Subtitles {activeSubtitle >= 0 && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>}
          </button>
          <button
            onClick={() => setActiveTab('audio')}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              activeTab === 'audio' 
                ? 'bg-primary text-black shadow-lg shadow-primary/20' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <i className="fa-solid fa-volume-high"></i>
            Audio {audioTracks.length > 0 && <span className="text-[10px] opacity-70">({audioTracks.length})</span>}
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {activeTab === 'subtitles' ? (
            <>
              {/* Quick Enable/Disable Toggle */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-3.5 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-white">Subtitles Display</h4>
                  <p className="text-gray-400 text-[11px]">
                    {activeSubtitle >= 0 ? `Active: ${subtitles[activeSubtitle]?.name || 'Enabled'}` : 'Turned Off'}
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (activeSubtitle >= 0) {
                      onSubtitleChange(-1);
                    } else if (subtitles.length > 0) {
                      onSubtitleChange(0);
                    }
                  }}
                  className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
                    activeSubtitle >= 0 
                      ? 'bg-emerald-500 text-black shadow-md shadow-emerald-500/30' 
                      : 'bg-white/10 text-gray-300 hover:bg-white/20'
                  }`}
                >
                  {activeSubtitle >= 0 ? 'ON' : 'OFF'}
                </button>
              </div>

              {/* Timing Sync & Size */}
              {activeSubtitle >= 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {/* Timing Offset */}
                  <div className="bg-white/5 border border-white/5 rounded-2xl p-3">
                    <p className="text-gray-400 text-[10px] uppercase font-bold tracking-wider mb-2">Sync Timing</p>
                    <div className="flex items-center justify-between gap-1">
                      <button 
                        onClick={() => onSubtitleOffsetChange(Math.round((subtitleOffset - 0.5) * 10) / 10)}
                        className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-bold"
                        title="-0.5s"
                      >
                        -0.5s
                      </button>
                      <button
                        onClick={() => onSubtitleOffsetChange(0)}
                        className="text-xs font-mono text-primary font-bold px-1"
                        title="Reset to 0s"
                      >
                        {subtitleOffset > 0 ? `+${subtitleOffset}s` : `${subtitleOffset}s`}
                      </button>
                      <button 
                        onClick={() => onSubtitleOffsetChange(Math.round((subtitleOffset + 0.5) * 10) / 10)}
                        className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-bold"
                        title="+0.5s"
                      >
                        +0.5s
                      </button>
                    </div>
                  </div>

                  {/* Font Size */}
                  <div className="bg-white/5 border border-white/5 rounded-2xl p-3">
                    <p className="text-gray-400 text-[10px] uppercase font-bold tracking-wider mb-2">Text Size</p>
                    <div className="flex items-center gap-1">
                      {(['small', 'medium', 'large'] as const).map(size => (
                        <button
                          key={size}
                          onClick={() => onSubtitleFontSizeChange(size)}
                          className={`flex-1 py-1 rounded-lg text-[10px] font-bold uppercase transition-all ${
                            subtitleFontSize === size 
                              ? 'bg-primary text-black' 
                              : 'bg-white/10 text-gray-300 hover:bg-white/20'
                          }`}
                        >
                          {size[0].toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Language Search */}
              {subtitles.length > 5 && (
                <div className="relative">
                  <i className="fa-solid fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs"></i>
                  <input
                    type="text"
                    placeholder="Search language..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary"
                  />
                </div>
              )}

              {/* Subtitle List */}
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {/* Off Option */}
                <button
                  onClick={() => {
                    onSubtitleChange(-1);
                    onClose();
                  }}
                  className={`w-full p-3 rounded-xl text-left flex items-center justify-between text-xs font-bold transition-all border ${
                    activeSubtitle === -1 
                      ? 'bg-primary/20 border-primary text-primary' 
                      : 'bg-white/5 border-white/5 text-gray-300 hover:bg-white/10'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <i className="fa-solid fa-ban text-xs"></i> Off
                  </span>
                  {activeSubtitle === -1 && <i className="fa-solid fa-check text-primary"></i>}
                </button>

                {filteredSubtitles.map(({ sub, index }) => {
                  const isSelected = activeSubtitle === index;
                  const langName = sub.name || getLanguageName(sub.lang || sub.language || 'en');
                  const code = sub.languageCode || sub.lang || '';
                  return (
                    <button
                      key={index}
                      onClick={() => {
                        onSubtitleChange(index);
                        onClose();
                      }}
                      className={`w-full p-3 rounded-xl text-left flex items-center justify-between text-xs font-bold transition-all border ${
                        isSelected 
                          ? 'bg-primary text-black border-primary shadow-lg shadow-primary/20' 
                          : 'bg-white/5 border-white/5 text-white hover:bg-white/10'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        {code && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase ${
                            isSelected ? 'bg-black/20 text-black' : 'bg-white/10 text-gray-400'
                          }`}>
                            {code}
                          </span>
                        )}
                        <span>{langName}</span>
                      </div>
                      {isSelected && <i className="fa-solid fa-check text-xs"></i>}
                    </button>
                  );
                })}

                {subtitles.length === 0 && (
                  <div className="text-center py-8 text-gray-500 text-xs">
                    <i className="fa-solid fa-closed-captioning text-2xl mb-2 block opacity-30"></i>
                    No external subtitles available for this stream
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Audio Tab */
            <div className="space-y-3">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-3.5">
                <h4 className="text-sm font-bold text-white mb-1">Audio Output</h4>
                <p className="text-gray-400 text-[11px]">
                  High-fidelity stereo playback with automatic dynamic range leveling
                </p>
              </div>

              <div className="space-y-1.5">
                {audioTracks.length > 0 ? (
                  audioTracks.map((track, i) => {
                    const isSelected = activeAudioTrack === track.id || (activeAudioTrack === -1 && i === 0);
                    return (
                      <button
                        key={track.id}
                        onClick={() => {
                          onAudioTrackChange(track.id);
                          onClose();
                        }}
                        className={`w-full p-3 rounded-xl text-left flex items-center justify-between text-xs font-bold transition-all border ${
                          isSelected 
                            ? 'bg-primary text-black border-primary shadow-lg shadow-primary/20' 
                            : 'bg-white/5 border-white/5 text-white hover:bg-white/10'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <i className="fa-solid fa-music text-xs opacity-70"></i>
                          <span>{track.name || `Audio Track ${i + 1}`}</span>
                          {track.lang && (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-mono ${
                              isSelected ? 'bg-black/20 text-black' : 'bg-white/10 text-gray-400'
                            }`}>
                              {track.lang}
                            </span>
                          )}
                        </div>
                        {isSelected && <i className="fa-solid fa-check text-xs"></i>}
                      </button>
                    );
                  })
                ) : (
                  <div className="p-3 bg-white/5 border border-white/10 rounded-xl flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 text-white font-bold">
                      <i className="fa-solid fa-volume-high text-primary"></i>
                      <span>Default Stream Audio (Original Stereo)</span>
                    </div>
                    <i className="fa-solid fa-check text-primary"></i>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="p-3 border-t border-white/5 bg-black/40 text-center">
          <p className="text-[10px] text-gray-500">
            Press <kbd className="bg-white/10 px-1 py-0.5 rounded text-white font-mono">C</kbd> on keyboard to quickly toggle subtitles
          </p>
        </div>
      </div>
    </div>
  );
};
