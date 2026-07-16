import React, { useState, useEffect } from 'react';
import { useMovieDetails } from '../hooks/useMovieDetails';
import { Episode, MovieResult } from '../types';

interface BulkDownloadModalProps {
  movieId: string;
  seasonNumber?: number;
  isOpen: boolean;
  onClose: () => void;
  onDownload: (urls: string[]) => void;
}

const BulkDownloadModal: React.FC<BulkDownloadModalProps> = ({
  movieId,
  seasonNumber,
  isOpen,
  onClose,
  onDownload
}) => {
  const dummyMovie: MovieResult = {
    subjectId: movieId,
    detailPath: movieId,
    title: '',
    cover: '',
    thumbnail: '',
    type: 'Series'
  };

  const { movie, loading, error } = useMovieDetails(dummyMovie);
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [downloadType, setDownloadType] = useState<'zip' | 'folder'>('zip'); // Ask user

  const [downloadSubtitles, setDownloadSubtitles] = useState(true);

  const episodes = seasonNumber 
    ? movie?.seasons?.find((s: any) => s.seasonNumber === seasonNumber)?.episodes || []
    : [];

  const toggleEpisode = (index: number, url: string) => {
    setSelectedUrls(prev => 
      prev.includes(url)
        ? prev.filter(u => u !== url)
        : [...prev, url]
    );
  };

  const toggleSelectAll = () => {
    if (selectAll) {
      setSelectedUrls([]);
    } else {
      setSelectedUrls(episodes.map((_: any, i: number) => `/api/sources/${movieId}?season=${seasonNumber}&episode=${i+1}`));
    }
    setSelectAll(!selectAll);
  };

  const handleDownload = async () => {
    if (selectedUrls.length === 0) return;
    
    let linksText = `SL-FLIX Bulk Download Links\nMovie ID: ${movieId}\nSeason: ${seasonNumber || 'N/A'}\n\n`;
    let hasLinks = false;

    for (const url of selectedUrls) {
      try {
        const res = await fetch(url).then(r => r.json());
        if (res.results && res.results.length > 0) {
          const best = res.results.reduce((prev: any, current: any) => (parseInt(prev.quality) > parseInt(current.quality)) ? prev : current);
          if (best.download) {
            linksText += `Video: ${best.download}\n`;
            hasLinks = true;
          }
        }
        if (downloadSubtitles && res.subtitles && res.subtitles.length > 0) {
          const engSub = res.subtitles.find((s: any) => s.name.toLowerCase().includes('english')) || res.subtitles[0];
          if (engSub && engSub.url) {
            linksText += `Subtitle: ${engSub.url}\n`;
          }
        }
        linksText += '\n';
      } catch (e) {
        console.error("Failed to fetch download links for", url);
      }
    }
    
    if (hasLinks) {
      const blob = new Blob([linksText], { type: 'text/plain' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `slflix_downloads_${movieId}_s${seasonNumber || 1}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    }
    
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-slate-900/50 backdrop-blur border-b border-slate-700 p-6 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-r from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center shadow-lg">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10l-5.5 5.5m0 0L7.5 20l5-5m-5 5L17 10m0 0V6m0 4h4" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-white bg-gradient-to-r from-white to-slate-200 bg-clip-text text-transparent">
                Bulk Download
              </h2>
              <p className="text-slate-400 text-sm">
                {selectedUrls.length} of {episodes.length} episodes selected ({(selectedUrls.length * 200).toLocaleString()} MB est.)
              </p>
            </div>
            <button onClick={onClose} className="ml-auto p-1 hover:bg-slate-700 rounded-lg transition-colors">
              <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Download Type */}
        <div className="p-6 border-b border-slate-700">
          <div className="flex flex-col gap-4">
            <div className="flex gap-4">
              <label className="flex items-center gap-2 p-3 rounded-lg bg-slate-800/50 cursor-pointer hover:bg-slate-700/50 transition-all">
                <input
                  type="radio"
                  name="downloadType"
                  value="zip"
                  checked={downloadType === 'zip'}
                  onChange={(e) => setDownloadType('zip' as any)}
                  className="w-4 h-4 text-emerald-500 bg-slate-700 border-slate-600 focus:ring-emerald-500"
                />
                <span className="text-white font-medium">ZIP Archive</span>
              </label>
              <label className="flex items-center gap-2 p-3 rounded-lg bg-slate-800/50 cursor-pointer hover:bg-slate-700/50 transition-all">
                <input
                  type="radio"
                  name="downloadType"
                  value="folder"
                  checked={downloadType === 'folder'}
                  onChange={(e) => setDownloadType('folder' as any)}
                  className="w-4 h-4 text-emerald-500 bg-slate-700 border-slate-600 focus:ring-emerald-500"
                />
                <span className="text-white font-medium">Folder</span>
              </label>
            </div>
            <label className="flex items-center gap-2 p-3 rounded-lg bg-slate-800/50 cursor-pointer hover:bg-slate-700/50 transition-all w-fit">
              <input
                type="checkbox"
                checked={downloadSubtitles}
                onChange={(e) => setDownloadSubtitles(e.target.checked)}
                className="w-4 h-4 text-emerald-500 bg-slate-700 border-slate-600 rounded focus:ring-emerald-500 focus:ring-2"
              />
              <span className="text-white font-medium">Download Subtitles</span>
            </label>
          </div>
        </div>

        {/* Episodes List */}
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <button
                onClick={toggleSelectAll}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg font-medium transition-all"
              >
                {selectAll ? 'Deselect All' : 'Select All'}
              </button>
              <span className="text-slate-400 text-sm">{episodes.length} episodes</span>
            </div>
            <button
              onClick={handleDownload}
              disabled={selectedUrls.length === 0}
              className="px-6 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-bold rounded-xl shadow-lg shadow-emerald-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Download {selectedUrls.length > 0 ? `(${selectedUrls.length})` : ''}
            </button>
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {episodes.map((ep: any, index: number) => (
              <label key={index} className="flex items-center justify-between p-3 rounded-xl bg-slate-800/50 hover:bg-slate-700/50 transition-all cursor-pointer group border border-transparent hover:border-slate-600">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedUrls.includes(`/api/sources/${movieId}?season=${seasonNumber}&episode=${index+1}`)}
                    onChange={() => toggleEpisode(index, `/api/sources/${movieId}?season=${seasonNumber}&episode=${index+1}`)}
                    className="w-4 h-4 text-emerald-500 bg-slate-700 border-slate-600 rounded focus:ring-emerald-500 focus:ring-2"
                  />
                  <div>
                    <div className="font-medium text-white">{ep.title || `Episode ${index+1}`}</div>
                    <div className="text-xs text-slate-400">{(200 * (index+1)).toLocaleString()} KB est.</div>
                  </div>
                </div>
                <div className="text-xs text-slate-400 opacity-0 group-hover:opacity-100">
                  {index+1}
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BulkDownloadModal;

