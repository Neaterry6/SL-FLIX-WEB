import React, { useState, useEffect } from 'react';
import { useMovieDetails } from '../hooks/useMovieDetails';
import { Episode, MovieResult } from '../types';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
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
  const { movie, loading } = useMovieDetails(dummyMovie);
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [downloadType, setDownloadType] = useState<'zip' | 'folder'>('folder'); 
  const [downloadSubtitles, setDownloadSubtitles] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, status: '' });
  const episodes = seasonNumber 
    ? movie?.seasons?.find((s: any) => s.seasonNumber === seasonNumber)?.episodes || 
      Array.from(
        { length: movie?.seasons?.find((s: any) => s.seasonNumber === seasonNumber)?.episodeCount || 0 },
        (_, i) => ({ episodeNumber: i + 1 })
      )
    : [];
  const toggleEpisode = (index: number) => {
    const url = `/api/sources/${movieId}?season=${seasonNumber}&episode=${index+1}`;
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
  const downloadFile = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      return blob;
    } catch (e) {
      console.error(`Failed to download ${url}`, e);
      return null;
    }
  };
  const triggerDownload = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 100);
  };
  const handleDownload = async () => {
    if (selectedUrls.length === 0) return;
    setIsProcessing(true);
    setProgress({ current: 0, total: selectedUrls.length, status: 'Fetching links...' });
    const downloadLinks: { url: string; filename: string; type: 'video' | 'subtitle' }[] = [];
    for (let i = 0; i < selectedUrls.length; i++) {
      const url = selectedUrls[i];
      try {
        const res = await fetch(url).then(r => r.json());
        const epNum = i + 1;
        if (res.results && res.results.length > 0) {
          const best = res.results.reduce((prev: any, current: any) => 
            (parseInt(prev.quality) > parseInt(current.quality)) ? prev : current
          );
          if (best.download || best.url) {
            downloadLinks.push({ 
              url: best.download || best.url, 
              filename: `${movie?.title || 'Video'}_S${seasonNumber}_E${epNum}.mp4`,
              type: 'video'
            });
          }
        }
        if (downloadSubtitles && res.subtitles && res.subtitles.length > 0) {
          const engSub = res.subtitles.find((s: any) => s.name.toLowerCase().includes('english')) || res.subtitles[0];
          if (engSub && engSub.url) {
             downloadLinks.push({ 
               url: engSub.url, 
               filename: `${movie?.title || 'Video'}_S${seasonNumber}_E${epNum}.srt`,
               type: 'subtitle'
             });
          }
        }
      } catch (e) {
        console.error("Failed to fetch info for", url);
      }
      setProgress(p => ({ ...p, current: i + 1 }));
    }
    if (downloadLinks.length === 0) {
      alert("No downloadable links found.");
      setIsProcessing(false);
      return;
    }
    if (downloadType === 'zip') {
      const zip = new JSZip();
      const folder = zip.folder(`${movie?.title || 'Downloads'}_S${seasonNumber}`);
      setProgress({ current: 0, total: downloadLinks.length, status: 'Creating ZIP (Downloading files)...' });
      for (let i = 0; i < downloadLinks.length; i++) {
        const link = downloadLinks[i];
        setProgress(p => ({ ...p, current: i + 1, status: `Downloading ${link.filename}...` }));
        const blob = await downloadFile(link.url, link.filename);
        if (blob) {
          folder?.file(link.filename, blob);
        } else {
          triggerDownload(link.url, link.filename);
        }
      }
      setProgress({ current: 100, total: 100, status: 'Finalizing ZIP...' });
      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, `${movie?.title || 'slflix'}_S${seasonNumber}.zip`);
    } else {
      setProgress({ current: 0, total: downloadLinks.length, status: 'Triggering downloads...' });
      downloadLinks.forEach((link, i) => {
        setTimeout(() => {
          triggerDownload(link.url, link.filename);
          setProgress(p => ({ ...p, current: i + 1 }));
        }, i * 500); 
      });
    }
    setIsProcessing(false);
    onClose();
  };
  if (!isOpen || !movieId) return null;
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        {}
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
                {isProcessing ? progress.status : `${selectedUrls.length} of ${episodes.length} episodes selected`}
              </p>
            </div>
            <button onClick={onClose} disabled={isProcessing} className="ml-auto p-1 hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-30">
              <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {isProcessing && (
            <div className="mt-4 h-1.5 w-full bg-slate-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          )}
        </div>
        {}
        <div className="p-6 border-b border-slate-700">
          <div className="flex flex-col gap-4">
            <div className="flex gap-4">
              <label className={`flex items-center gap-2 p-3 rounded-lg bg-slate-800/50 cursor-pointer hover:bg-slate-700/50 transition-all ${isProcessing ? 'opacity-50 pointer-events-none' : ''}`}>
                <input
                  type="radio"
                  name="downloadType"
                  value="zip"
                  checked={downloadType === 'zip'}
                  onChange={() => setDownloadType('zip')}
                  className="w-4 h-4 text-emerald-500 bg-slate-700 border-slate-600 focus:ring-emerald-500"
                />
                <span className="text-white font-medium">ZIP Archive</span>
              </label>
              <label className={`flex items-center gap-2 p-3 rounded-lg bg-slate-800/50 cursor-pointer hover:bg-slate-700/50 transition-all ${isProcessing ? 'opacity-50 pointer-events-none' : ''}`}>
                <input
                  type="radio"
                  name="downloadType"
                  value="folder"
                  checked={downloadType === 'folder'}
                  onChange={() => setDownloadType('folder')}
                  className="w-4 h-4 text-emerald-500 bg-slate-700 border-slate-600 focus:ring-emerald-500"
                />
                <span className="text-white font-medium">Individual (Folder)</span>
              </label>
            </div>
            <label className={`flex items-center gap-2 p-3 rounded-lg bg-slate-800/50 cursor-pointer hover:bg-slate-700/50 transition-all w-fit ${isProcessing ? 'opacity-50 pointer-events-none' : ''}`}>
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
        {}
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <button
                onClick={toggleSelectAll}
                disabled={isProcessing}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg font-medium transition-all disabled:opacity-50"
              >
                {selectAll ? 'Deselect All' : 'Select All'}
              </button>
              <span className="text-slate-400 text-sm">{episodes.length} episodes</span>
            </div>
            <button
              onClick={handleDownload}
              disabled={selectedUrls.length === 0 || isProcessing}
              className="px-6 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-bold rounded-xl shadow-lg shadow-emerald-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isProcessing ? 'Processing...' : `Download ${selectedUrls.length > 0 ? `(${selectedUrls.length})` : ''}`}
            </button>
          </div>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {episodes.map((ep: any, index: number) => {
              const url = `/api/sources/${movieId}?season=${seasonNumber}&episode=${index+1}`;
              return (
                <label key={index} className={`flex items-center justify-between p-3 rounded-xl bg-slate-800/50 hover:bg-slate-700/50 transition-all cursor-pointer group border border-transparent hover:border-slate-600 ${isProcessing ? 'opacity-50 pointer-events-none' : ''}`}>
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedUrls.includes(url)}
                      onChange={() => toggleEpisode(index)}
                      className="w-4 h-4 text-emerald-500 bg-slate-700 border-slate-600 rounded focus:ring-emerald-500 focus:ring-2"
                    />
                    <div>
                      <div className="font-medium text-white">{ep.title || `Episode ${index+1}`}</div>
                      <div className="text-xs text-slate-400">Ready for download</div>
                    </div>
                  </div>
                  <div className="text-xs text-slate-400 opacity-0 group-hover:opacity-100">
                    S{seasonNumber} E{index+1}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
export default BulkDownloadModal;