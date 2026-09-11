export const DEFAULT_FAVICON_FALLBACK = '/icons/slflix.png';

export const getOptimizedImageUrl = (url?: string, width: number = 300) => {
    if (!url || !url.trim() || url === 'undefined' || url === 'null') {
        return DEFAULT_FAVICON_FALLBACK;
    }
    if (url.startsWith('/') || url.includes('wsrv.nl')) return url;
    return `https://wsrv.nl/?url=${encodeURIComponent(url)}&output=webp&w=${width}&q=80`;
};