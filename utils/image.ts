export const DEFAULT_FAVICON_FALLBACK = '/icons/slflix.png';

export const getOptimizedImageUrl = (url?: string, _width: number = 300) => {
    if (!url || typeof url !== 'string' || !url.trim() || url === 'undefined' || url === 'null') {
        return DEFAULT_FAVICON_FALLBACK;
    }
    const cleanUrl = url.trim();
    // Upgrade insecure http to https where applicable
    if (cleanUrl.startsWith('http://')) {
        return cleanUrl.replace('http://', 'https://');
    }
    return cleanUrl;
};
