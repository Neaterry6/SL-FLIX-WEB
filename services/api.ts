import { MovieResult, CastMember, Season, CategoryData, VideoSource, Subtitle, ImdbSuggestion, LiveChannel, IpcResult, WebtoonItem, WebtoonDetail, WebtoonRead } from '../types';
import { cacheService, CacheService } from './cache';
import { safeConsole } from '../utils/productionGuard';

/**
 * SL-FLIX PRO API Service
 * Uses Vite proxy to hide real APIs and bypass CORS.
 * Uses Cineverse API for search and sources.
 * Includes multi-layer caching for instant loading.
 */

const VIRTUAL_API_PATH = "/slflix/api/v1";

/**
 * Convert SRT subtitle content to WebVTT format
 * SRT uses comma for milliseconds, VTT uses period
 * VTT requires "WEBVTT" header
 */
const convertSrtToVtt = (srtContent: string): string => {
    if (srtContent.trim().startsWith('WEBVTT')) {
        return srtContent;
    }
    
    // Add WEBVTT header
    let vtt = 'WEBVTT\n\n';
    
    // Process each line
    const lines = srtContent.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        
        // Skip empty lines (will add double newline later)
        if (!line) continue;
        
        // Check if this is a timestamp line (contains -->)
        if (line.includes('-->')) {
            // Replace comma with period for milliseconds (SRT: 00:00:20,000 -> VTT: 00:00:20.000)
            line = line.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/, '$1.$2');
            // Also handle case where comma might be at different position
            line = line.replace(/,/g, '.');
            vtt += line + '\n';
        } else if (!isNaN(Number(line)) && line.includes('\n')) {
            // Skip sequence numbers (standalone numbers followed by newline in SRT)
            // This is already handled by the trim() above
            continue;
        } else {
            // Regular text line
            // Decode HTML entities that might be encoded
            line = line
                .replace(/</g, '<')
                .replace(/>/g, '>')
                .replace(/&amp;/g, '&')
                .replace(/"/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&apos;/g, "'");
            vtt += line + '\n';
        }
    }
    
    return vtt;
};

// Cache for converted VTT blob URLs
const vttBlobCache = new Map<string, string>();

/**
 * Convert SRT URL to VTT blob URL
 * Fetches the SRT, converts to VTT, creates a blob URL
 */
const convertSrtUrlToVttBlob = async (srtUrl: string): Promise<string> => {
    // Check cache first
    if (vttBlobCache.has(srtUrl)) {
        return vttBlobCache.get(srtUrl)!;
    }
    
    try {
        let response;
        try {
            // Add referer header to bypass CORS
            response = await fetch(srtUrl, {
                headers: {
                    'Referer': 'https://123movienow.cc/',
                    'Origin': 'https://123movienow.cc'
                }
            });
        } catch (e) {
            safeConsole.warn('[Subtitle] Direct fetch failed, trying CORS proxy for:', srtUrl);
            response = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(srtUrl)}`);
        }
        
        if (!response || !response.ok) {
            safeConsole.warn('[Subtitle] Failed to fetch SRT:', response?.status);
            return srtUrl; // Return original URL as fallback
        }
        
        const srtContent = await response.text();
        
        // Check if it's already VTT or not valid SRT
        if (!srtContent.includes('-->')) {
            safeConsole.warn('[Subtitle] Invalid SRT content');
            return srtUrl; // Return original URL as fallback
        }
        
        const vttContent = convertSrtToVtt(srtContent);
        
        // Create blob URL
        const blob = new Blob([vttContent], { type: 'text/vtt' });
        const blobUrl = URL.createObjectURL(blob);
        
        // Cache the blob URL (will be valid for session)
        vttBlobCache.set(srtUrl, blobUrl);
        
        safeConsole.log('[Subtitle] Converted SRT to VTT, blob URL created');
        return blobUrl;
    } catch (error) {
        safeConsole.warn('[Subtitle] Error converting SRT to VTT:', error);
        return srtUrl; // Return original URL as fallback
    }
};

/**
 * Production AUTH context
 */
const AUTH_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOjc2NjM1Nzg0MjYwMzI2Njk2MzIsImF0cCI6MywiZXh0IjoxNzcyMTU4NjE1fQ.IEBtmZQL_ZTWvqbAZbb60r4aq2U9uTLTMBOS2UdVNMA";
const USER_ID = "7663578426032669632";
const X_USER_AUTH = `{"token":"${AUTH_TOKEN}","userId":"${USER_ID}","userType":0,"appType":3}`;

// Retry helper with exponential backoff - keeps retrying indefinitely
async function fetchWithRetry<T>(
    fetchFn: () => Promise<T>,
    retries: number = 10,
    delay: number = 2000
): Promise<T> {
    let lastError: Error | null = null;
    
    for (let i = 0; i < retries; i++) {
        try {
            return await fetchFn();
        } catch (error) {
                        lastError = error as Error;
            if ((error as any).status === 429) {
                console.warn('[API] Rate limit hit (429). Stop retrying.');
                break;
            }
            safeConsole.warn(`[API] Retry ${i + 1}/${retries} failed:`, error);
            if (i < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
            }
        }
    }
    throw lastError;
}

// Fetch through proxy - adds required headers
async function fetchJson(url: string, options: RequestInit = {}) {
    const isPlayer = url.includes("api-player");
    const isCineverse = url.includes("api-cineverse");

    const baseHeaders: Record<string, string> = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-App-Version': '3.7.0',
        'X-User': X_USER_AUTH,
        'Authorization': `Bearer ${AUTH_TOKEN}`,
    };

    // Add proxy-specific headers
    if (isPlayer) {
        baseHeaders['Origin'] = 'https://123movienow.cc';
        baseHeaders['Referer'] = 'https://123movienow.cc/';
    } else if (isCineverse) {
        baseHeaders['Origin'] = 'https://cineverse.name.ng';
        baseHeaders['Referer'] = 'https://cineverse.name.ng/';
    }

    const res = await fetch(url, { ...options, headers: { ...baseHeaders, ...options.headers } });
        if (!res.ok) {
        const err = new Error(`HTTP Error: ${res.status}`);
        (err as any).status = res.status;
        throw err;
    }
    return res.json();
}

/**
 * Routes virtual endpoints to Vite proxy endpoints.
 */
async function internalFetch(virtualEndpoint: string, options: RequestInit = {}): Promise<any> {
    const [pathPart, queryPart] = virtualEndpoint.split('?');
    const params = new URLSearchParams(queryPart || '');
        
    const cleanPath = pathPart.replace(VIRTUAL_API_PATH, '');
        
    if (cleanPath.startsWith('/search')) {
        const keyword = params.get('q') || '';
        const page = params.get('page') || '1';
        const targetUrl = `/api-omegatech/api/movie/MovieBox-pro?action=search&keyword=${encodeURIComponent(keyword)}&page=${page}`;
        return fetchJson(targetUrl, options);
    }
        
    if (cleanPath.startsWith('/home')) {
        return fetchJson('/api-metadata/home', options);
    }
        
    if (cleanPath.startsWith('/trending_search')) {
        return fetchJson('/api-metadata/subject/everyone-search', options);
    }
        
    if (cleanPath.startsWith('/ranking')) {
        const id = params.get('id') || '';
        const page = params.get('page') || '1';
        const perPage = params.get('perPage') || '12';
        return fetchJson(`/api-metadata/ranking-list/content?id=${id}&page=${page}&perPage=${perPage}`, options);
    }
        
    if (cleanPath.startsWith('/detail')) {
        const subjectId = params.get('subjectId') || '';
        const detailPath = params.get('path') || params.get('detailPath') || '';
        if (detailPath && !/^\d+$/.test(detailPath)) {
            return fetchJson(`/api-metadata/detail?detailPath=${encodeURIComponent(detailPath)}`, options);
        }
        return fetchJson(`/api-metadata/detail?subjectId=${subjectId}&detailPath=${encodeURIComponent(detailPath)}`, options);
    }
        
    if (cleanPath.startsWith('/play')) {
        const subjectId = params.get('subjectId') || '';
        const se = params.get('se') || '0';
        const ep = params.get('ep') || '0';
        const detailPath = params.get('detailPath') || '';
        const targetUrl = `/api-omegatech/api/movie/MovieBox-pro?action=download&subjectId=${subjectId}&se=${se}&ep=${ep}${detailPath ? `&detailPath=${encodeURIComponent(detailPath)}` : ''}`;
        return fetchJson(targetUrl, options);
    }
        
    if (cleanPath.startsWith('/rec')) {
        const id = params.get('id') || '';
        return fetchJson(`/api-metadata/subject/detail-rec?subjectId=${id}&page=1&perPage=12`, options);
    }
        
    return { code: -1, message: 'Unknown endpoint', data: null };
}

/**
 * Normalize API response to MovieResult
 */
const normalizeItem = (item: any): MovieResult => {
    if (!item) return {} as MovieResult;
    const d = item.subject || item.data || item;
    
    let type = 'Movie';
    const sType = d.subjectType !== undefined ? d.subjectType : (d.type === 'TV' ? 2 : (d.type === 'Movie' ? 1 : d.type));
    if (sType === 2 || sType === 'TV Series' || d.category === 'Series' || d.type === 'TV') type = 'TV Series';
    else if (sType === 6) type = 'Music Video';
    else if (sType === 7) type = 'Short TV';
    else if (sType === 9 || d.category === 'Sport') type = 'Live Sport';

    let cover = '';
    if (typeof d.cover === 'string') cover = d.cover;
    else if (d.cover?.url) cover = d.cover.url;
    else if (d.thumbnail) cover = d.thumbnail;
    else if (d.image?.url) cover = d.image.url;
    else if (d.pic?.normal) cover = d.pic.normal;
    else if (d.poster?.url) cover = d.poster.url;
    else if (d.horizontal_cover?.url) cover = d.horizontal_cover.url;

    const description = d.description || d.introduction || d.synopsis || d.content || d.summary || d.desc || d.info || d.description_en || d.introduction_en || d.summary_en || d.postTitle;
    const rating = d.imdbRatingValue || d.imdbRating || d.rate || d.score || d.rating || '0';

    return {
        title: d.title || d.name || d.subjectName || "Unknown",
        cover: cover,
        thumbnail: cover,
        type: type,
        subjectId: String(d.subjectId || d.id || d.mid || ''),
        imdbRating: String(rating),
        releaseDate: String(d.releaseDate || d.release_date || d.year || d.publish_date || ''),
        genre: d.genre || d.genres || d.categoryName || '',
        description: description || '',
        countryName: d.countryName || d.country || '',
        detailPath: d.detailPath || d.path || '',
        hasResource: d.hasResource !== undefined ? d.hasResource : true
    };
};

/**
 * Normalize ranking/list response
 */
const normalizeRankingItem = (item: any): MovieResult => {
    if (!item) return {} as MovieResult;
    
    let cover = '';
    if (typeof item.cover === 'string') cover = item.cover;
    else if (item.cover?.url) cover = item.cover.url;
    
    return {
        title: item.title || "Unknown",
        cover: cover,
        thumbnail: cover,
        type: item.subjectType === 1 ? 'Movie' : (item.subjectType === 2 ? 'TV Series' : 'Movie'),
        subjectId: String(item.subjectId || ''),
        imdbRating: String(item.imdbRatingValue || '0'),
        releaseDate: String(item.releaseDate || ''),
        genre: item.genre || '',
        description: item.description || '',
        countryName: item.countryName || '',
        detailPath: item.detailPath || '',
        hasResource: item.hasResource !== undefined ? item.hasResource : true
    };
};

// Category IDs for ranking
const CATEGORY_IDS: Record<string, string> = {
    'trending': '1232643093049001320',
    'movies': '997144265920760504',
    'anime': '62133389738001440',
    'nollywood': '8216283712045280',
    'sa_series': '4307848214843217008',
    'black_drama': '8505361996374835640',
    'western': '2540573817806670120',
    'k_drama': '4380734070238626200',
    'c_drama': '173752404280836544',
    'thai_drama': '1164329479448281992',
    'turkish': '9193088611682599936',
    'animation': '7132534597631837112'
};

export const ApiService = {
    // Search with caching - instant load from cache, background refresh
    search: async (query: string, page: number = 1) => {
        if (!query || !query.trim()) return { results: [], hasMore: false, nextPage: 1, totalCount: 0 };
        
        const cacheKey = CacheService.searchKey(query, page);
        
        // Try cache first for page 1
        if (page === 1) {
            const cached = cacheService.get<{ results: MovieResult[]; hasMore: boolean; nextPage: number; totalCount: number }>(cacheKey);
            if (cached && cached.data) {
                // Refresh in background
                cacheService.prefetch(cacheKey, () => ApiService.search(query, page), 3 * 60 * 1000);
                return cached.data;
            }
        }
        
        try {
            const url = `/api-omegatech/api/movie/MovieBox-pro?action=search&keyword=${encodeURIComponent(query.trim())}&page=${page}`;
            const data = await fetchJson(url);
            
            console.log('[SLFLIX] Cineverse search response:', data);
            
            if ((data.success || data.code === 0) && (data.data?.items || data.results?.items)) {
                const searchData = data.data || data.results || {};
                const pager = searchData.pager || {};
                const result = {
                    results: (searchData.items || []).map(normalizeItem),
                    hasMore: pager.hasMore || false,
                    nextPage: parseInt(pager.nextPage) || (page + 1),
                    totalCount: pager.totalCount || 0
                };
                
                // Cache the results
                if (page === 1) {
                    cacheService.set(cacheKey, result, 3 * 60 * 1000);
                }
                
                return result;
            }
            
            return { results: [], hasMore: false, nextPage: 1, totalCount: 0 };
        } catch (e) {
            console.error('[SLFLIX] Search error:', e);
            
            // Return cached data if available on error
            const cached = cacheService.get<{ results: MovieResult[]; hasMore: boolean; nextPage: number; totalCount: number }>(cacheKey);
            if (cached && cached.data) {
                return cached.data;
            }
            
            return { results: [], hasMore: false, nextPage: 1, totalCount: 0 };
        }
    },

    // Get home page data with caching - instant load
    getHomeData: async () => {
        const cacheKey = 'home:data';
        
        // Try cache first
        const cached = cacheService.get<{ categories: CategoryData[]; hero: MovieResult[] }>(cacheKey);
        if (cached && cached.data && !cached.isStale) {
            // Prefetch fresh data in background
            cacheService.prefetch(cacheKey, () => ApiService.getHomeData(), 5 * 60 * 1000);
            return cached.data;
        }
        
        try {
            const data = await fetchWithRetry(
                () => internalFetch(`${VIRTUAL_API_PATH}/home`),
                2, 1
            );
            
            let categories: CategoryData[] = [];
            let hero: MovieResult[] = [];
            
            // Check if the response matches our backend's direct normalized format { categories, hero }
            if (data && (Array.isArray(data.categories) || Array.isArray(data.hero))) {
                categories = (data.categories || []).map((cat: any) => ({
                    title: cat.name || cat.title || 'Featured',
                    query: cat.id || '',
                    movies: (cat.items || cat.movies || []).map((m: any) => ({
                        title: m.title || 'Unknown',
                        cover: m.cover || m.thumbnail || '',
                        thumbnail: m.thumbnail || m.cover || '',
                        type: m.type || 'Movie',
                        subjectId: String(m.subjectId || m.id || ''),
                        imdbRating: String(m.imdbRating || m.rating || '0'),
                        releaseDate: String(m.releaseDate || ''),
                        detailPath: m.detailPath || '',
                        hasResource: m.hasResource !== undefined ? m.hasResource : true
                    }))
                }));

                hero = (data.hero || []).map((m: any) => ({
                    title: m.title || 'Unknown',
                    cover: m.cover || m.backdrop || '',
                    thumbnail: m.thumbnail || m.cover || '',
                    type: m.type || 'Movie',
                    subjectId: String(m.subjectId || m.id || ''),
                    imdbRating: String(m.imdbRating || m.rating || '0'),
                    releaseDate: String(m.releaseDate || ''),
                    detailPath: m.detailPath || '',
                    hasResource: m.hasResource !== undefined ? m.hasResource : true
                }));
            } else if (data && data.code === 0 && data.data?.operatingList) {
                // Legacy un-normalized layout parser
                data.data.operatingList.forEach((op: any) => {
                    if (op.type === 'BANNER' && op.banner?.items) {
                        hero = op.banner.items.map(normalizeItem);
                    } else if ((op.type === 'SUBJECTS_MOVIE' || op.type === 'SUBJECT_LIST' || op.type === 'APPOINTMENT_LIST') && op.subjects?.length) {
                        categories.push({ title: op.title || "Recommended", query: op.id || '', movies: op.subjects.map(normalizeItem) });
                    }
                });
            } else {
                // Return cached if available or empty default
                const staleCached = cacheService.get<{ categories: CategoryData[]; hero: MovieResult[] }>(cacheKey);
                return staleCached?.data || { categories: [], hero: [] };
            }

            // Add Georgian Trending content if available, but call it with Promise.race to avoid blocking
            try {
                const tvHome = await Promise.race([
                    ApiService.getTvHome(),
                    new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
                ]).catch(() => null);

                if (tvHome?.data?.trending?.films?.length) {
                    const geoMovies = tvHome.data.trending.films.map((f: any) => ({
                        title: f.title,
                        cover: f.image,
                        thumbnail: f.image,
                        type: 'Movie',
                        subjectId: String(f.id),
                        imdbRating: f.imdb_rating,
                        releaseDate: f.year,
                        detailPath: f.slug,
                        hasResource: true
                    }));
                    categories.unshift({ title: "Trending in Georgia", query: "georgia", movies: geoMovies });
                }
            } catch (e) {
                console.warn("[ApiService] Failed to fetch Georgian trending for home", e);
            }
            
            const result = { categories, hero };
            
            // Cache the successful result
            cacheService.set(cacheKey, result, 5 * 60 * 1000);
            
            return result;
        } catch (e) {
            console.error('[SLFLIX] Home data error:', e);
            // Return cached data if available on error
            const cached = cacheService.get<{ categories: CategoryData[]; hero: MovieResult[] }>(cacheKey);
            return cached?.data || { categories: [], hero: [] };
        }
    },




    // Get movie details with caching
    getDetails: async (movie: MovieResult) => {
        let enhanced = { ...movie };
        const path = movie.detailPath;
        const subjectId = movie.subjectId;
        const cacheKey = CacheService.movieKey(subjectId, path);
        
        // Check cache first
        const cached = cacheService.get<MovieResult>(cacheKey);
        if (cached && cached.data && !cached.isStale) {
            return { ...cached.data, ...movie };
        }
        
        if (path || subjectId) {
            try {
                const data = await fetchWithRetry(
                    () => internalFetch(`${VIRTUAL_API_PATH}/detail?subjectId=${subjectId || ''}&path=${path || ''}`),
                    2, 1
                );
                
                if ((data.code === 0 || data.success) && data.data) {
                    const d = data.data;
                    const s = d.subject || d.subjectDetail || d.detail || d.info || d.data || d;
                    
                    enhanced.description = s.description || s.introduction || s.synopsis || s.content || s.summary || s.desc || enhanced.description;
                    enhanced.title = s.title || s.name || s.subjectName || enhanced.title;
                    enhanced.imdbRating = String(s.imdbRatingValue || s.imdbRating || enhanced.imdbRating);
                    enhanced.subjectId = String(s.subjectId || enhanced.subjectId);
                    enhanced.detailPath = s.detailPath || enhanced.detailPath;
                    if (s.hasResource !== undefined) enhanced.hasResource = s.hasResource;

                    const coverUrl = s.cover?.url || s.pic?.normal || s.image?.url || s.cover || s.poster?.url;
                    if (coverUrl && typeof coverUrl === 'string') enhanced.cover = coverUrl;

                    const stars = d.stars || s.staffList || d.staffList || s.stars || s.actors;
                    if (stars && Array.isArray(stars)) {
                        enhanced.cast = stars.map((st: any) => ({ name: st.name || st.staffName || "Unknown", character: st.character || st.role || '', avatar: st.avatarUrl || st.avatar || '', id: String(st.staffId || st.id || '') }));
                    }

                    // Improved seasons extraction - check d.resource.seasons first (actual API structure)
                    let seasons: any[] = [];
                    
                    // First check d.resource.seasons (actual API response structure)
                    if (d.resource?.seasons && Array.isArray(d.resource.seasons)) {
                        seasons = d.resource.seasons;
                        console.log('[SLFLIX] Seasons from d.resource.seasons:', seasons);
                    }
                    // Fallback to s.resource.seasons
                    else if (s.resource?.seasons && Array.isArray(s.resource.seasons)) {
                        seasons = s.resource.seasons;
                    }
                    // Check s.seasons
                    else if (s.seasons && Array.isArray(s.seasons)) {
                        seasons = s.seasons;
                    }
                    // Check d.seasons
                    else if (d.seasons && Array.isArray(d.seasons)) {
                        seasons = d.seasons;
                    }
                    // Check episodes array
                    else if (s.episodes && Array.isArray(s.episodes)) {
                        const seasonMap = new Map<number, number>();
                        s.episodes.forEach((ep: any) => {
                            const sn = ep.seasonNumber || ep.season || 1;
                            seasonMap.set(sn, (seasonMap.get(sn) || 0) + 1);
                        });
                        seasons = Array.from(seasonMap.entries()).map(([seasonNumber, episodeCount]) => ({
                            se: seasonNumber,
                            maxEp: episodeCount,
                            episodeCount
                        }));
                    }
                    // Check totalEpisodes/totalSeasons
                    else if (s.totalEpisodes && s.totalSeasons) {
                        for (let i = 1; i <= (s.totalSeasons || 1); i++) {
                            seasons.push({
                                se: i,
                                maxEp: s.totalEpisodes,
                                episodeCount: s.totalEpisodes
                            });
                        }
                    }

                    if (seasons.length > 0) {
                        enhanced.seasons = seasons.map((se: any) => ({ 
                            seasonNumber: se.seasonNumber || se.se || 1, 
                            episodeCount: se.maxEp || se.episodeCount || se.totalEpisodes || 12 
                        }));
                        console.log('[SLFLIX] Seasons extracted:', enhanced.seasons);
                    } else if (s.type === 'TV Series' || s.subjectType === 2 || s.category === 'Series') {
                        enhanced.seasons = [{ seasonNumber: 1, episodeCount: s.episodeCount || s.totalEpisodes || 12 }];
                    }
                    
                    enhanced.trailerUrl = s.trailer?.videoAddress?.url || s.trailer?.url || s.trailerUrl;
                    if (s.dubs) enhanced.dubs = s.dubs;
                    
                    // Cache enhanced details
                    cacheService.set(cacheKey, enhanced, 10 * 60 * 1000);
                }
            } catch (e) {
                console.warn("[SLFLIX] Detail metadata failed", e);
            }
        }
        
        const recId = enhanced.subjectId;
        if (recId && recId !== 'undefined') {
            try {
                const recData = await internalFetch(`${VIRTUAL_API_PATH}/rec?id=${recId}`);
                const recItems = recData.data?.items || recData.data?.list || [];
                if (Array.isArray(recItems)) {
                    enhanced.recommendations = recItems.map(normalizeItem);
                }
            } catch (e) {
                console.warn("[SLFLIX] Recommendations failed", e);
            }
        }
        
        return enhanced;
    },

    // Get streaming sources with caching
    getSources: async (subjectId: string, type: string, season = 1, episode = 1, detailPath?: string) => {
        const cacheKey = CacheService.sourcesKey(subjectId, season, episode);
        
        const cached = cacheService.get<{ videos: VideoSource[]; subs: Subtitle[] }>(cacheKey);
        if (cached && cached.data && !cached.isStale) {
            return cached.data;
        }
        
        try {
            // Call our backend API which handles Omegatech + Fallbacks
            const url = `/api/sources/${subjectId}?type=${type}&season=${season}&episode=${episode}${detailPath ? `&path=${encodeURIComponent(detailPath)}` : ''}`;
            
            console.log('[SLFLIX] Getting sources from backend:', url);
            const data = await fetchWithRetry(() => fetchJson(url), 3, 2000);
            
            if (data.results) {
                const videos = data.results;
                const subs = data.subtitles || [];
                
                const result = { videos, subs };
                cacheService.set(cacheKey, result, 5 * 60 * 1000);
                return result;
            }
            
            return { videos: [], subs: [] };
        } catch (e) {
            console.error("[SLFLIX] Sources fetch failed", e);
            const cached = cacheService.get<{ videos: VideoSource[]; subs: Subtitle[] }>(cacheKey);
            return cached?.data || { videos: [], subs: [] };
        }
    },

    // TV & Sports (ch.omegatech.app)
    getTvHome: async (): Promise<any> => {
        return fetchJson('/api/tv/home');
    },

    getTvChannels: async (params: { cat?: string; q?: string; offset?: number; limit?: number } = {}): Promise<any> => {
        const { cat, q, offset, limit } = params;
        let url = `/api/tv/channels?limit=${limit || 500}&offset=${offset || 0}`;
        if (cat) url += `&cat=${encodeURIComponent(cat)}`;
        if (q) url += `&q=${encodeURIComponent(q)}`;
        return fetchJson(url);
    },

    getTvGuide: async (date?: string): Promise<any> => {
        let url = '/api/tv/guide';
        if (date) url += `?date=${date}`;
        return fetchJson(url);
    },

    getTvOnNow: async (): Promise<any> => {
        return fetchJson('/api/tv/onnow');
    },

    getTvMatches: async (season?: string): Promise<any> => {
        let url = '/api/tv/matches';
        if (season) url += `?season=${season}`;
        return fetchJson(url);
    },

    getLegacyLiveTv: async (): Promise<any> => {
        return fetchJson('/api/live-tv');
    },

    // Get live channels
    getLiveChannels: async (): Promise<LiveChannel[]> => {
        const cacheKey = 'live:channels';
        const cached = cacheService.get<LiveChannel[]>(cacheKey);
        if (cached?.data) return cached.data;

        try {
            const data = await fetchJson('/api/live-tv');
            if (Array.isArray(data)) {
                cacheService.set(cacheKey, data, 30 * 60 * 1000);
                return data;
            }
            return [];
        } catch (e) {
            return [];
        }
    },

    // Search IPC (Vidbox)
    searchIpc: async (query: string, season?: number, episode?: number): Promise<IpcResult[]> => {
        if (!query) return [];
        try {
            let url = `/api/ipc/search?query=${encodeURIComponent(query)}`;
            if (season) url += `&season=${season}`;
            if (episode) url += `&episode=${episode}`;
            const data = await fetchJson(url);
            return Array.isArray(data) ? data : [];
        } catch (e) {
            return [];
        }
    },


    // Get trending searches
    getTrendingSearches: async () => {
        const cacheKey = 'trending:searches';
        
        const cached = cacheService.get<string[]>(cacheKey);
        if (cached?.data) {
            cacheService.prefetch(cacheKey, () => ApiService.getTrendingSearches(), 2 * 60 * 1000);
            return cached.data;
        }
        
        try {
            const data = await internalFetch(`${VIRTUAL_API_PATH}/trending_search`);
            const result = data.data?.everyoneSearch?.map((s: any) => s.title) || [];
            cacheService.set(cacheKey, result, 2 * 60 * 1000);
            return result;
        } catch (e) { 
            const cached = cacheService.get<string[]>(cacheKey);
            return cached?.data || [];
        }
    },

    // Get trending from API
    getTrending: async (page: number = 0, perPage: number = 18) => {
        const cacheKey = `trending:${page}:${perPage}`;
        
        const cached = cacheService.get<{ results: MovieResult[]; hasMore: boolean; nextPage: number; totalCount: number }>(cacheKey);
        if (cached?.data) {
            cacheService.prefetch(cacheKey, () => ApiService.getTrending(page, perPage), 2 * 60 * 1000);
            return cached.data;
        }
        
        try {
            const url = `/api-metadata/subject/trending?page=${page}&perPage=${perPage}`;
            const data = await fetchJson(url);
            
            console.log('[API] Trending response:', data);
            
            if ((data.code === 0 || data.success) && (data.data?.subjectList || data.data?.list)) {
                const pager = data.data.pager || {};
                const result = {
                    results: (data.data.subjectList || data.data.list || []).map(normalizeRankingItem),
                    hasMore: pager.hasMore || false,
                    nextPage: parseInt(pager.nextPage) || (page + 1),
                    totalCount: pager.totalCount || data.data.subjectList.length
                };
                cacheService.set(cacheKey, result, 2 * 60 * 1000);
                return result;
            }
            
            return { results: [], hasMore: false, nextPage: page + 1, totalCount: 0 };
        } catch (e) {
            console.error('[API] Trending error:', e);
            const cached = cacheService.get<{ results: MovieResult[]; hasMore: boolean; nextPage: number; totalCount: number }>(cacheKey);
            return cached?.data || { results: [], hasMore: false, nextPage: 1, totalCount: 0 };
        }
    },

    // Get ranking list
    getRankingList: async (category: string, page: number = 1, perPage: number = 12) => {
        try {
            const catId = CATEGORY_IDS[category.toLowerCase()] || CATEGORY_IDS['trending'];
            const data = await internalFetch(`${VIRTUAL_API_PATH}/ranking?id=${catId}&page=${page}&perPage=${perPage}`);
            
            if ((data.code === 0 || data.success) && (data.data?.subjectList || data.data?.list)) {
                const pager = data.data.pager || {};
                return {
                    title: data.data.title || category,
                    results: (data.data.subjectList || data.data.list || []).map(normalizeRankingItem),
                    hasMore: pager.hasMore || false,
                    nextPage: parseInt(pager.nextPage) || (page + 1)
                };
            }
            
            return { title: category, results: [], hasMore: false, nextPage: page + 1 };
        } catch (e) {
            console.error('[SLFLIX] Ranking list error:', e);
            return { title: category, results: [], hasMore: false, nextPage: page + 1 };
        }
    },

    // IMDB suggestions
    getImdbSuggestions: async (query: string) => {
        try {
            const clean = query.replace(/[^\w\s]/g, '').trim();
            if (clean.length < 2) return [];
            const url = `https://v3.sg.media-imdb.com/suggestion/${clean.charAt(0).toLowerCase()}/${encodeURIComponent(clean)}.json`;
            const res = await fetch(url);
            const data = await res.json();
            return data?.d || [];
        } catch (e) { return []; }
    },

    getMovieById: async (id: string): Promise<MovieResult> => ({
        title: "Loading...", cover: "", thumbnail: "", type: "Movie", subjectId: id, detailPath: id
    }),

    // Webtoon methods
        getNews: async (page: number = 1): Promise<any> => {
        const cacheKey = `news:page:${page}`;
        const cached = cacheService.get<any>(cacheKey);
        if (cached && cached.data) {
            return cached.data;
        }
        try {
            const res = await fetch(`/api/sport/trend?page=${page}`);
            if (!res.ok) throw new Error("API not found");
            const data = await res.json();
            cacheService.set(cacheKey, data, 5 * 60 * 1000); // 5 mins client cache
            return data;
        } catch (e) {
            throw e;
        }
    },

    getSportFeeds: async (): Promise<any> => {
        const cacheKey = 'sport:feeds';
        const cached = cacheService.get<any>(cacheKey);
        if (cached && cached.data) {
            return cached.data;
        }
        try {
            const data = await fetchJson('/api/sport/feeds');
            cacheService.set(cacheKey, data, 60 * 1000); // 1 minute client cache
            return data;
        } catch (e) {
            console.error('[API] Failed to fetch sport feeds:', e);
            return null;
        }
    },

    getSportMatchDetail: async (id: string): Promise<any> => {
        const cacheKey = `sport:match:${id}`;
        const cached = cacheService.get<any>(cacheKey);
        if (cached && cached.data) {
            return cached.data;
        }
        try {
            const data = await fetchJson(`/api/sport/match-detail?id=${id}`);
            cacheService.set(cacheKey, data, 30 * 1000); // 30 seconds client cache for live events
            return data;
        } catch (e) {
            console.error('[API] Failed to fetch sport match details:', e);
            return null;
        }
    },

    getWebtoonHome: async (): Promise<{ trending: WebtoonItem[] }> => {
        const cacheKey = 'webtoon:home';
        const cached = cacheService.get<{ trending: WebtoonItem[] }>(cacheKey);
        if (cached && cached.data) {
            return cached.data;
        }
        try {
            const data = await fetchJson('/api/webtoon/home');
            cacheService.set(cacheKey, data, 10 * 60 * 1000);
            return data;
        } catch (e) {
            return { trending: [] };
        }
    },

    searchWebtoon: async (query: string): Promise<{ results: WebtoonItem[] }> => {
        const cacheKey = `webtoon:search:${query}`;
        const cached = cacheService.get<{ results: WebtoonItem[] }>(cacheKey);
        if (cached && cached.data) {
            return cached.data;
        }
        try {
            const data = await fetchJson(`/api/webtoon/search?query=${encodeURIComponent(query)}`);
            cacheService.set(cacheKey, data, 5 * 60 * 1000); // 5 minutes cache
            return data;
        } catch (e) {
            return { results: [] };
        }
    },

    getWebtoonDetail: async (url: string): Promise<WebtoonDetail | null> => {
        const cacheKey = `webtoon:detail:${url}`;
        const cached = cacheService.get<WebtoonDetail>(cacheKey);
        if (cached && cached.data) {
            return cached.data;
        }
        try {
            const data = await fetchJson(`/api/webtoon/detail?url=${encodeURIComponent(url)}`);
            cacheService.set(cacheKey, data, 15 * 60 * 1000); // 15 minutes cache
            return data;
        } catch (e) {
            return null;
        }
    },

    readWebtoon: async (url: string): Promise<WebtoonRead | null> => {
        const cacheKey = `webtoon:read:${url}`;
        const cached = cacheService.get<WebtoonRead>(cacheKey);
        if (cached && cached.data) {
            return cached.data;
        }
        try {
            const data = await fetchJson(`/api/webtoon/read?url=${encodeURIComponent(url)}`);
            cacheService.set(cacheKey, data, 30 * 60 * 1000); // 30 minutes cache for read chapters
            return data;
        } catch (e) {
            return null;
        }
    }
};

// Ranking categories
export const RANKING_CATEGORIES = [
    { id: 'trending', name: 'Trending Now', icon: 'fa-fire' },
    { id: 'movies', name: 'Popular Movies', icon: 'fa-film' },
    { id: 'anime', name: 'Anime', icon: 'fa-dragon' },
    { id: 'k_drama', name: 'K-Drama', icon: 'fa-heart' },
    { id: 'c_drama', name: 'C-Drama', icon: 'fa-scroll' },
    { id: 'thai_drama', name: 'Thai-Drama', icon: 'fa-spa' },
    { id: 'turkish', name: 'Turkish Drama', icon: 'fa-star' },
    { id: 'western', name: 'Western TV', icon: 'fa-tv' },
    { id: 'nollywood', name: 'Nollywood', icon: 'fa-mask' },
    { id: 'sa_series', name: 'South African', icon: 'fa-globe-africa' },
    { id: 'black_drama', name: 'Black Drama', icon: 'fa-users' },
    { id: 'animation', name: 'Animation', icon: 'fa-ghost' }
];

export const CATEGORIES: any[] = [];

