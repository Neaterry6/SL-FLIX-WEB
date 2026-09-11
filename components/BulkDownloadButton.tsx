import React from 'react';
interface BulkDownloadButtonProps {
  movieId: string;
  seasonNumber?: number;
  onClick: () => void;
  className?: string;
}
const BulkDownloadButton: React.FC<BulkDownloadButtonProps> = ({
  movieId,
  seasonNumber,
  onClick,
  className = ''
}) => {
  return (
    <button
      onClick={onClick}
      className={`
        ${className}
        inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 
        hover:from-emerald-600 hover:to-teal-700 text-white font-medium rounded-xl 
        shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 
        transition-all duration-200 hover:scale-105 active:scale-95
      `}
      title={`Bulk download season ${seasonNumber || 'all'}`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10l-5.5 5.5m0 0L7.5 20l5-5m-5 5L17 10m0 0V6m0 4h4" />
      </svg>
      Bulk Download
    </button>
  );
};
export default BulkDownloadButton;