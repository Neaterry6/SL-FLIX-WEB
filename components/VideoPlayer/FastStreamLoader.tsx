import React from 'react';

export const FastStreamLoader: React.FC<{ buffered?: number }> = ({ buffered }) => {
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
