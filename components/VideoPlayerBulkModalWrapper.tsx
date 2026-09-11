import React, { useState } from 'react';
import BulkDownloadModal from './BulkDownloadModal';
interface VideoPlayerBulkModalWrapperProps {
  movieId: string;
  seasonNumber?: number;
  className?: string;
}
const VideoPlayerBulkModalWrapper: React.FC<VideoPlayerBulkModalWrapperProps> = ({
  movieId,
  seasonNumber,
  className
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const handleDownload = (urls: string[]) => {
    urls.forEach(url => {
      window.open(url, '_blank');
    });
  };
  return (
    <>
      <div className={className}>
        <button 
          onClick={() => setIsOpen(true)}
          className="w-9 h-9 flex items-center justify-center text-white hover:bg-white/10 rounded-full bg-white/10 transition-colors"
          title="Bulk Download"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10l-5.5 5.5m0 0L7.5 20l5-5m-5 5L17 10m0 0V6m0 4h4" />
          </svg>
        </button>
      </div>
      <BulkDownloadModal
        movieId={movieId}
        seasonNumber={seasonNumber}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onDownload={handleDownload}
      />
    </>
  );
};
export default VideoPlayerBulkModalWrapper;