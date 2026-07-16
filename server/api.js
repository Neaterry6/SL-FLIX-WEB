import express from 'express';
import rateLimit from 'express-rate-limit';
import NodeCache from 'node-cache';
import crypto from 'crypto';
import https from 'https';
import http from 'http';

const router = express.Router();


const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

const streamTokenCache = new NodeCache({ stdTTL: 7200, checkperiod: 600 });


function generateStreamToken(url) {
    const token = crypto.randomBytes(16).toString('hex');
    streamTokenCache.set(token, url);
    return token;
}


function proxyStreamRequest(req, res, targetUrlStr, extraHeaders = {}) {
    if (res.headersSent) return;
    
    let targetUrl;
    try {
        targetUrl = new URL(targetUrlStr);
    } catch (e) {
        return res.status(400).send('Invalid target URL');
    }

    
    if (req.method === 'OPTIONS') {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Range, Content-Type, Authorization, X-Requested-With');
        res.header('Access-Control-Max-Age', '86400');
        return res.sendStatus(200);
    }

    
    const requestHeaders = { ...req.headers };
    delete requestHeaders['host'];
    delete requestHeaders['connection'];
    delete requestHeaders['content-length'];
    delete requestHeaders['accept-encoding']; 

    const isManifest = targetUrlStr.includes('.m3u8') || targetUrlStr.includes('.m3u');

    const reqHeaders = {
        ...requestHeaders,
        host: targetUrl.hostname,
        ...extraHeaders,
        'Cache-Control': 'no-cache'
    };
    if (!isManifest) {
        reqHeaders['Range'] = req.headers['range'] || 'bytes=0-';
    }

    const options = {
        hostname: targetUrl.hostname,
        path: targetUrl.pathname + targetUrl.search,
        method: req.method,
        headers: reqHeaders,
        timeout: 60000,
    };

    const protocol = targetUrl.protocol === 'https:' ? https : http;

    const proxyReq = protocol.request(options, (proxyRes) => {
        if (res.headersSent) return;
        
        
        if (proxyRes.statusCode && proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
            const redirectUrl = new URL(proxyRes.headers.location, targetUrlStr);
            return proxyStreamRequest(req, res, redirectUrl.toString(), extraHeaders);
        }
        
        
        const headers = { ...proxyRes.headers };
        delete headers['access-control-allow-origin'];
        delete headers['server'];
        delete headers['content-encoding'];
        
        const contentType = headers['content-type'] || '';
        const reallyIsManifest = isManifest || 
                               contentType.includes('mpegurl') || 
                               contentType.includes('apple.mpegurl') || 
                               contentType.includes('application/x-mpegURL');

        if (!headers['content-type'] || headers['content-type'] === 'application/octet-stream') {
            if (targetUrlStr.includes('.mp4')) headers['content-type'] = 'video/mp4';
            else if (reallyIsManifest) headers['content-type'] = 'application/vnd.apple.mpegurl';
            else if (targetUrlStr.includes('.ts')) headers['content-type'] = 'video/mp2t';
        }

        headers['Access-Control-Allow-Origin'] = '*';
        headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
        headers['Access-Control-Allow-Headers'] = 'Range, Content-Type, Authorization, X-Requested-With';

        
        if (reallyIsManifest && (proxyRes.statusCode === 200 || proxyRes.statusCode === 206)) {
            let body = '';
            proxyRes.on('data', chunk => { body += chunk; });
            proxyRes.on('end', () => {
                const rewrittenBody = rewriteHlsManifest(body, targetUrlStr);
                headers['content-length'] = Buffer.byteLength(rewrittenBody);
                res.writeHead(200, headers);
                res.end(rewrittenBody);
            });
            return;
        }
        
        res.writeHead(proxyRes.statusCode || 200, headers);
        proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
        if (res.headersSent) return;
        console.error(`[STREAM PROXY] Error for ${targetUrlStr}:`, err.message);
        
        res.status(502).json({ error: "Upstream Error", message: "Failed to connect to stream" });
    });

    proxyReq.on('timeout', () => {
        if (res.headersSent) return;
        proxyReq.destroy();
        res.status(504).json({ error: "Gateway Timeout", message: 'Proxy timeout' });
    });

    if (req.body && (req.method === 'POST' || req.method === 'PUT')) {
        req.pipe(proxyReq, { end: true });
    } else {
        proxyReq.end();
    }
}


function rewriteHlsManifest(content, baseUrlStr) {
    const lines = content.split('\n');
    const baseUrl = new URL(baseUrlStr);
    const baseDir = baseUrlStr.substring(0, baseUrlStr.lastIndexOf('/') + 1);
    
    return lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            
            if (trimmed.includes('URI="') && !trimmed.includes('URI="http')) {
                return trimmed.replace(/URI="([^"]+)"/, (match, p1) => {
                    try {
                        const absoluteUrl = p1.startsWith('/') ? new URL(p1, baseUrl.origin).toString() : new URL(p1, baseDir).toString();
                        return `URI="/api/stream/proxy?url=${encodeURIComponent(absoluteUrl)}"`;
                    } catch (e) { return match; }
                });
            }
            return line;
        }
        
        try {
            let absoluteUrl;
            if (trimmed.startsWith('http')) absoluteUrl = trimmed;
            else if (trimmed.startsWith('/')) absoluteUrl = new URL(trimmed, baseUrl.origin).toString();
            else absoluteUrl = new URL(trimmed, baseDir).toString();
            
            // Proxy it!
            const proxiedPath = absoluteUrl.includes('.m3u8') || absoluteUrl.includes('.m3u') || absoluteUrl.includes('.ts') || absoluteUrl.includes('.key')
                ? `/api/stream/proxy?url=${encodeURIComponent(absoluteUrl)}`
                : `/api/stream/proxy?url=${encodeURIComponent(absoluteUrl)}`; // Just default to it
            
            return proxiedPath;
        } catch (e) {
            return line;
        }
    }).join('\n');
}

// Rate limiting middleware
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: {
        error: "Too many requests",
        message: "Rate limit exceeded. Please try again later.",
        retryAfter: 900
    },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false, default: false },
    keyGenerator: (req) => {
        // Use Forwarded or X-Forwarded-For if available, otherwise fallback to req.ip
        const forwardedHeader = req.headers['forwarded'];
        if (forwardedHeader) {
            const match = forwardedHeader.match(/for="?([^;"]+)"?/);
            if (match && match[1]) return match[1].trim();
        }
        const xForwardedFor = req.headers['x-forwarded-for'];
        if (xForwardedFor) {
            return xForwardedFor.split(',')[0].trim();
        }
        return req.ip;
    }
});


router.use(apiLimiter);


const AUTH_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOjc2NjM1Nzg0MjYwMzI2Njk2MzIsImF0cCI6MywiZXh0IjoxNzcyMTU4NjE1fQ.IEBtmZQL_ZTWvqbAZbb60r4aq2U9uTLTMBOS2UdVNMA";
const USER_ID = "7663578426032669632";
const X_USER_AUTH = `{"token":"${AUTH_TOKEN}","userId":"${USER_ID}","userType":0,"appType":3}`;

const baseHeaders = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'X-App-Version': '3.7.0',
    'X-User': X_USER_AUTH,
    'Authorization': `Bearer ${AUTH_TOKEN}`,
};


async function fetchExternal(url, options = {}, attempt = 1) {
    const isPlayer = url.includes("123movienow.cc");
    const isCineverse = url.includes("cineverse.name.ng");
    const isOmegaTv = url.includes("ch.omegatech.app");

    let headers = { ...baseHeaders, ...options.headers };

    if (isOmegaTv) {
        
        headers = {
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Referer': 'https://ch.omegatech.app/',
            'Origin': 'https://ch.omegatech.app',
            ...options.headers
        };
    }

    if (isPlayer) {
        headers['Origin'] = 'https://123movienow.cc';
        headers['Referer'] = 'https://123movienow.cc/';
    } else if (isCineverse) {
        headers['Origin'] = 'https://cineverse.name.ng';
        headers['Referer'] = 'https://cineverse.name.ng/';
    } else if (isOmegaTv) {
        headers['Origin'] = 'https://ch.omegatech.app';
        headers['Referer'] = 'https://ch.omegatech.app/';
    } else {
        headers['Origin'] = 'https://moviebox.ph';
        headers['Referer'] = 'https://moviebox.ph/';
    }

    
    const delay = Math.min(attempt * 1000, 30000);

    try {
        const res = await fetch(url, { 
            ...options, 
            headers,
            signal: AbortSignal.timeout(30000) 
        });
        
        if (res.ok) {
            const data = await res.json();
            return data;
        }
        
        
        if (res.status >= 500 || res.status === 0) {
            console.warn(`[API] ${res.status || 'Timeout'} for ${url}, retry ${attempt}...`);
            await new Promise(r => setTimeout(r, delay));
            return fetchExternal(url, options, attempt + 1);
        }
        
        return res.json();
} catch (error) {
        if (error.name !== 'AbortError' && (error.message.includes('503') || error.message.includes('fetch') || error.message.includes('Failed'))) {
            console.warn(`[API] Error for ${url}: ${error.message}, retry ${attempt}...`);
            await new Promise(r => setTimeout(r, delay));
            return fetchExternal(url, options, attempt + 1);
        }
        
        console.error(`[API] Final fail ${url}:`, error.message);
        return { results: [], success: true }; 
    }
}


router.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        const page = req.query.page || '1';
        
        if (!query || query.length < 2) {
            return res.status(400).json({
                error: "Invalid request",
                message: "Search query must be at least 2 characters"
            });
        }

        const cacheKey = `search_${query}_${page}`;
        const cached = cache.get(cacheKey);
        if (cached) return res.json(cached);

        
        try {
            const cineverseUrl = `https://cineverse.name.ng/api/search?q=${encodeURIComponent(query)}`;
            const cineverseData = await fetchExternal(cineverseUrl);
            
            if (cineverseData && cineverseData.results && cineverseData.results.items && cineverseData.results.items.length > 0) {
                const results = cineverseData.results.items.map(item => ({
                    id: String(item.subjectId || item.id),
                    title: item.title,
                    cover: item.cover?.url || (item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : ''),
                    releaseDate: item.releaseDate || item.release_date || item.first_air_date || '',
                    genre: item.genre || '',
                    rating: item.imdbRatingValue || item.vote_average || 0,
                    description: item.description || item.overview || '',
                    type: item.subjectType === 2 ? 'TV Series' : 'Movie'
                }));
                
                const response = {
                    results,
                    hasMore: cineverseData.results.pager?.hasMore || false,
                    totalCount: cineverseData.results.pager?.totalCount || results.length
                };
                cache.set(cacheKey, response);
                return res.json(response);
            }
        } catch (e) {
            console.warn('[API] Cineverse search failed, falling back to metadata:', e.message);
        }

        
        const targetUrl = `https://h5-api.aoneroom.com/wefeed-h5api-bff/search?keyword=${encodeURIComponent(query)}&page=${page}&perPage=24`;
        const data = await fetchExternal(targetUrl);
        
        const results = (data.data?.list || []).map(item => {
            const d = item.subject || item;
            let type = 'Movie';
            const sType = d.subjectType !== undefined ? d.subjectType : (d.type === 'TV' ? 2 : (d.type === 'Movie' ? 1 : d.type));
            if (sType === 2 || sType === 'TV Series' || d.category === 'Series' || d.type === 'TV') type = 'TV Series';
            
            let cover = '';
            if (typeof d.cover === 'string') cover = d.cover;
            else if (d.cover?.url) cover = d.cover.url;
            else if (d.thumbnail) cover = d.thumbnail;
            
            return {
                id: String(d.subjectId || d.id || d.mid || ''),
                title: d.title || d.name || d.subjectName || "Unknown",
                cover: cover,
                releaseDate: String(d.releaseDate || d.release_date || d.year || d.publish_date || ''),
                genre: d.genre || d.genres || d.categoryName || '',
                rating: d.imdbRatingValue || d.imdbRating || d.rate || d.score || d.rating || '0',
                description: d.description || d.introduction || d.summary || '',
                type: type,
                detailPath: d.detailPath || d.path || ''
            };
        });

        const response = {
            results,
            hasMore: data.data?.hasMore || false,
            totalCount: data.data?.total || results.length
        };
        
        cache.set(cacheKey, response);
        res.json(response);
    } catch (error) {
        console.error('[API] Search error:', error);
        res.status(500).json({
            error: "Internal server error",
            message: "Service temporarily unavailable"
        });
    }
});


router.get('/movie/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const detailPath = req.query.path || '';
        
        const cacheKey = `movie_${id}_${detailPath}`;
        const cached = cache.get(cacheKey);
        if (cached) return res.json(cached);

        let targetUrl = `https://h5-api.aoneroom.com/wefeed-h5api-bff/detail?subjectId=${id}`;
        if (detailPath) {
            targetUrl += `&detailPath=${encodeURIComponent(detailPath)}`;
        }

        const data = await fetchExternal(targetUrl);
        const d = data.data?.resource || data.data || {};
        
        let type = 'Movie';
        const sType = d.subjectType !== undefined ? d.subjectType : (d.type === 'TV' ? 2 : (d.type === 'Movie' ? 1 : d.type));
        if (sType === 2 || sType === 'TV Series' || d.category === 'Series' || d.type === 'TV') type = 'TV Series';

        let cover = '';
        if (typeof d.cover === 'string') cover = d.cover;
        else if (d.cover?.url) cover = d.cover.url;
        else if (d.thumbnail) cover = d.thumbnail;
        else if (d.poster?.url) cover = d.poster.url;

        let backdrop = '';
        if (d.horizontal_cover?.url) backdrop = d.horizontal_cover.url;
        else if (d.backdrop?.url) backdrop = d.backdrop.url;

        
        let seasons = [];
        if (d.seasons && Array.isArray(d.seasons)) {
            seasons = d.seasons.map(s => ({
                id: String(s.id || s.seasonId || s.season_number || ''),
                name: s.name || s.title || `Season ${s.season_number || s.seasonNo || 1}`,
                seasonNumber: parseInt(s.season_number || s.seasonNo || 1),
                episodes: (s.episodes || s.episodeList || []).map(ep => ({
                    id: String(ep.id || ep.episodeId || ep.episode_number || ''),
                    title: ep.title || ep.name || `Episode ${ep.episode_number || ep.episodeNo || 1}`,
                    episodeNumber: parseInt(ep.episode_number || ep.episodeNo || 1),
                    overview: ep.overview || ep.description || '',
                    stillPath: ep.still_path || ep.cover?.url || ''
                }))
            }));
        }

        const response = {
            id: String(d.subjectId || d.id || d.mid || id),
            title: d.title || d.name || d.subjectName || "Unknown",
            description: d.description || d.introduction || d.summary || '',
            cover: cover,
            backdrop: backdrop,
            releaseDate: String(d.releaseDate || d.release_date || d.year || d.publish_date || ''),
            genre: d.genre || d.genres || d.categoryName || '',
            rating: d.imdbRatingValue || d.imdbRating || d.rate || d.score || d.rating || '0',
            duration: d.duration || d.runtime || '',
            cast: (d.actors || d.cast || []).map(a => a.name || a),
            director: (d.directors || d.director || []).map(d => d.name || d).join(', '),
            isSeries: type === 'TV Series',
            seasons: seasons,
            detailPath: d.detailPath || d.path || detailPath
        };

        cache.set(cacheKey, response);
        res.json(response);
    } catch (error) {
        console.error('[API] Movie details error:', error);
        res.status(500).json({
            error: "Internal server error",
            message: "Service temporarily unavailable"
        });
    }
});


router.get('/sources/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const type = req.query.type || 'Movie';
        const season = req.query.season || '1';
        const episode = req.query.episode || '1';
        const detailPath = req.query.path || '';
        
        const cacheKey = `sources_${id}_${type}_${season}_${episode}_${detailPath}`;
        const cached = cache.get(cacheKey);
        if (cached) return res.json(cached);

        
        try {
            const omegatechUrl = `https://omegatech-api.dixonomega.tech/api/movie/MovieBox-pro?action=download&subjectId=${id}&se=${type.includes('Series') ? season : 0}&ep=${type.includes('Series') ? episode : 0}${detailPath ? `&detailPath=${encodeURIComponent(detailPath)}` : ''}`;
            const omegatechData = await fetchExternal(omegatechUrl);
            
            if (omegatechData.success && (omegatechData.proxy || omegatechData.streams)) {
                const results = [];
                
                
                if (omegatechData.proxy) {
                    const proxy = omegatechData.proxy;
                    Object.keys(proxy).forEach(key => {
                        if (key.startsWith('stream')) {
                            const qualityStr = key.replace('stream', ''); 
                            const downloadKey = key.replace('stream', 'download');
                            const streamUrl = proxy[key];
                            const downloadUrl = proxy[downloadKey] || proxy[key];
                            
                            results.push({
                                id: key,
                                quality: qualityStr,
                                stream: `/api/stream/proxy?url=${encodeURIComponent(streamUrl)}`,
                                direct: `/api/stream/proxy?url=${encodeURIComponent(streamUrl)}`,
                                download: `/api/stream/proxy?url=${encodeURIComponent(downloadUrl)}`,
                                label: qualityStr,
                                type: streamUrl.includes('.m3u8') ? 'hls' : 'mp4'
                            });
                        }
                    });
                }
                
                
                if (results.length === 0 && omegatechData.streams) {
                    omegatechData.streams.forEach(s => {
                        results.push({
                            id: s.id || Math.random().toString(),
                            quality: `${s.resolution}p`,
                            stream: `/api/stream/proxy?url=${encodeURIComponent(s.originalUrl)}`,
                            direct: `/api/stream/proxy?url=${encodeURIComponent(s.originalUrl)}`,
                            download: `/api/stream/proxy?url=${encodeURIComponent(s.originalUrl)}`,
                            label: s.quality || `${s.resolution}p`,
                            type: s.format?.toLowerCase() === 'hls' ? 'hls' : 'mp4'
                        });
                    });
                }

                if (results.length > 0) {
                    results.sort((a, b) => {
                        const qA = parseInt(a.quality) || 0;
                        const qB = parseInt(b.quality) || 0;
                        return qB - qA;
                    });
                    
                    const subs = (omegatechData.subtitles || []).map((s) => ({
                        lang: s.lang || s.language,
                        name: s.name || s.language,
                        url: s.url || s.file
                    }));

                    const response = { success: true, results, subtitles: subs };
                    cache.set(cacheKey, response);
                    return res.json(response);
                }
            }
        } catch (e) {
            console.warn('[API] Omegatech sources failed:', e.message);
        }


        try {
            let gzUrl = `https://gzmovieboxapi.septorch.tech/api/media?apikey=Godszeal&subjectId=${id}`;
            if (detailPath) {
                gzUrl += `&detailPath=${encodeURIComponent(detailPath)}`;
            }
            const isSeries = type.includes('Series') || type.includes('TV') || type.includes('Anime');
            
            if (isSeries) {
                gzUrl += `&season=${season}&episode=${episode}`;
            }
            
            let gzData = await fetchExternal(gzUrl);
            
            
            if (!isSeries && (!gzData || gzData.status !== "success" || !gzData.data?.downloads?.data?.downloads || gzData.data.downloads.data.downloads.length === 0)) {
                console.warn(`[API] GZMoviebox failed or empty for movie ${id}, retrying as series...`);
                const retryUrl = `${gzUrl}&season=${season}&episode=${episode}`;
                gzData = await fetchExternal(retryUrl);
            }
            
            if (gzData.status === "success" && gzData.data?.downloads?.data?.downloads && gzData.data.downloads.data.downloads.length > 0) {
                const downloads = gzData.data.downloads.data.downloads;
                const results = downloads.map((d, i) => ({
                    id: d.id || String(i + 1),
                    quality: d.resolution,
                    stream: `/api/stream/proxy?url=${encodeURIComponent(d.streamUrl)}`,
                    direct: `/api/stream/proxy?url=${encodeURIComponent(d.streamUrl)}`,
                    download: `/api/stream/proxy?url=${encodeURIComponent(d.downloadUrl)}`,
                    size: d.size || 'Unknown',
                    label: `${d.resolution}p`,
                    type: 'mp4'
                }));
                
                const subsData = gzData.data.subtitles?.data?.captions || gzData.data.downloads?.data?.captions || [];
                const subs = subsData.map((s) => ({
                    lang: s.lan,
                    name: s.lanName,
                    url: s.url
                }));

                const response = { success: true, results, subtitles: subs };
                cache.set(cacheKey, response);
                return res.json(response);
            }
        } catch (e) {
            console.warn('[API] GZMoviebox failed:', e.message);
        }



        
        let targetUrl = `https://123movienow.cc/wefeed-h5api-bff/subject/play?subjectId=${id}`;
        
        const isSeries = type.includes('Series') || type.includes('TV') || type.includes('Anime');
        if (isSeries) {
            targetUrl += `&se=${season}&ep=${episode}`;
        }
        
        if (detailPath) {
            targetUrl += `&detailPath=${encodeURIComponent(detailPath)}`;
        }
        
        let data = await fetchExternal(targetUrl);
        
        if (!isSeries && (!data || !data.success || !data.results || data.results.length === 0)) {
            console.warn(`[API] Fallback failed or empty for movie ${id}, retrying as series...`);
            const retryUrl = `${targetUrl}&se=${season}&ep=${episode}`;
            data = await fetchExternal(retryUrl);
        }
        
        if (data.success && data.results && data.results.length > 0) {
            const results = data.results.map(r => {
                const quality = parseInt(r.quality) || 480;
                const streamUrl = r.stream_url;
                const downloadUrl = r.download_url;
                
                const streamToken = generateStreamToken(streamUrl);
                const downloadToken = generateStreamToken(downloadUrl);

                return {
                    id: r.id || '1',
                    quality: `${quality}p`,
                    stream: `/api/stream/${streamToken}`,
                    direct: `/api/stream/${streamToken}`,
                    download: `/api/stream/${downloadToken}`,
                    size: r.size || 'Unknown',
                    type: (r.format === 'mp4' || streamUrl.includes('.mp4') || downloadUrl.includes('.mp4')) ? 'mp4' : 'hls'
                };
            });

            
            results.sort((a, b) => parseInt(b.quality) - parseInt(a.quality));

            
            if (results.length > 0) {
                results.push({
                    id: 'auto',
                    quality: 'Auto',
                    stream: results[0].stream,
                    direct: results[0].direct,
                    download: results[0].download,
                    size: 'Unknown',
                    type: results[0].type
                });
            }

            const response = { results };
            cache.set(cacheKey, response);
            return res.json(response);
        }

        res.json({ results: [] });
    } catch (error) {
        console.error('[API] Sources error:', error);
        res.status(500).json({
            error: "Internal server error",
            message: "Service temporarily unavailable"
        });
    }
});


router.get('/ranking/:category', async (req, res) => {
    try {
        const category = req.params.category;
        const page = req.query.page || '1';
        
        const cacheKey = `ranking_${category}_${page}`;
        const cached = cache.get(cacheKey);
        if (cached) return res.json(cached);

        
        let id = '';
        let title = 'Trending Movies';
        switch (category) {
            case 'trending': id = '1001'; title = 'Trending Now'; break;
            case 'popular': id = '1002'; title = 'Popular Movies'; break;
            case 'top-rated': id = '1003'; title = 'Top Rated'; break;
            case 'new-releases': id = '1004'; title = 'New Releases'; break;
            default: id = category; title = 'Ranking List';
        }

        const targetUrl = `https://h5-api.aoneroom.com/wefeed-h5api-bff/ranking-list/content?id=${id}&page=${page}&perPage=24`;
        const data = await fetchExternal(targetUrl);
        
        const results = (data.data?.list || []).map((item, index) => {
            const d = item.subject || item;
            let cover = '';
            if (typeof d.cover === 'string') cover = d.cover;
            else if (d.cover?.url) cover = d.cover.url;
            else if (d.thumbnail) cover = d.thumbnail;

            return {
                id: String(d.subjectId || d.id || d.mid || ''),
                rank: index + 1 + ((parseInt(page) - 1) * 24),
                title: d.title || d.name || d.subjectName || "Unknown",
                cover: cover,
                rating: d.imdbRatingValue || d.imdbRating || d.rate || d.score || d.rating || '0',
                releaseDate: String(d.releaseDate || d.release_date || d.year || d.publish_date || ''),
                detailPath: d.detailPath || d.path || ''
            };
        });

        const response = {
            results,
            hasMore: data.data?.hasMore || false,
            title: title,
            totalCount: data.data?.total || results.length
        };

        cache.set(cacheKey, response);
        res.json(response);
    } catch (error) {
        console.error('[API] Ranking error:', error);
        res.status(500).json({
            error: "Internal server error",
            message: "Service temporarily unavailable"
        });
    }
});


router.get('/home', async (req, res) => {
    try {
        const cacheKey = 'home_data';
        const cached = cache.get(cacheKey);
        if (cached) return res.json(cached);

        const targetUrl = `https://h5-api.aoneroom.com/wefeed-h5api-bff/home`;
        const data = await fetchExternal(targetUrl);
        
        const categories = [];
        const hero = [];

        if (data.data?.list) {
            data.data.list.forEach(block => {
                if (block.type === 'banner' && block.items) {
                    block.items.forEach(item => {
                        const d = item.subject || item;
                        let cover = '';
                        if (typeof d.cover === 'string') cover = d.cover;
                        else if (d.cover?.url) cover = d.cover.url;
                        else if (d.thumbnail) cover = d.thumbnail;

                        let backdrop = '';
                        if (d.horizontal_cover?.url) backdrop = d.horizontal_cover.url;
                        else if (d.backdrop?.url) backdrop = d.backdrop.url;

                        hero.push({
                            id: String(d.subjectId || d.id || d.mid || ''),
                            title: d.title || d.name || d.subjectName || "Unknown",
                            cover: cover,
                            backdrop: backdrop || cover,
                            detailPath: d.detailPath || d.path || ''
                        });
                    });
                } else if (block.items && block.items.length > 0) {
                    const items = block.items.map(item => {
                        const d = item.subject || item;
                        let cover = '';
                        if (typeof d.cover === 'string') cover = d.cover;
                        else if (d.cover?.url) cover = d.cover.url;
                        else if (d.thumbnail) cover = d.thumbnail;

                        return {
                            id: String(d.subjectId || d.id || d.mid || ''),
                            title: d.title || d.name || d.subjectName || "Unknown",
                            cover: cover,
                            rating: d.imdbRatingValue || d.imdbRating || d.rate || d.score || d.rating || '0',
                            releaseDate: String(d.releaseDate || d.release_date || d.year || d.publish_date || ''),
                            detailPath: d.detailPath || d.path || ''
                        };
                    });

                    categories.push({
                        id: block.id || block.title || 'category',
                        name: block.title || 'Featured',
                        items: items
                    });
                }
            });
        }

        const response = { categories, hero };
        cache.set(cacheKey, response);
        res.json(response);
    } catch (error) {
        console.error('[API] Home data error:', error);
        res.status(500).json({
            error: "Internal server error",
            message: "Service temporarily unavailable"
        });
    }
});


router.get('/suggestions', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query || query.length < 2) {
            return res.status(400).json({
                error: "Invalid request",
                message: "Search query must be at least 2 characters"
            });
        }

        const cacheKey = `suggestions_${query}`;
        const cached = cache.get(cacheKey);
        if (cached) return res.json(cached);

        const firstLetter = query.charAt(0).toLowerCase();
        const targetUrl = `https://v3.sg.media-imdb.com/suggestion/x/${firstLetter}/${encodeURIComponent(query)}.json`;
        
        const response = await fetch(targetUrl);
        if (!response.ok) throw new Error(`IMDb Error: ${response.status}`);
        
        const data = await response.json();
        cache.set(cacheKey, data);
        res.json(data);
    } catch (error) {
        console.error('[API] Suggestions error:', error);
        res.status(500).json({
            error: "Internal server error",
            message: "Service temporarily unavailable"
        });
    }
});


router.get('/tv/proxy', (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('No URL provided');
    proxyStreamRequest(req, res, decodeURIComponent(url));
});


router.get('/tv/img', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('No URL provided');
    
    try {
        const decodedUrl = decodeURIComponent(url);
        if (!decodedUrl.startsWith('http')) return res.redirect(decodedUrl);

        const isOmegaTv = decodedUrl.includes("omegatech.app") || 
                          decodedUrl.includes("televizia.online") || 
                          decodedUrl.includes("1tv.ge") || 
                          decodedUrl.includes("pbcdnw.aoneroom.com") || 
                          decodedUrl.includes("comments.ge") ||
                          decodedUrl.includes("adjaranett.com") ||
                          decodedUrl.includes("imoviesge.com");
        
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        };
        
        if (isOmegaTv) {
            if (decodedUrl.includes("comments.ge")) {
                headers['Referer'] = 'https://comments.ge/';
            } else if (decodedUrl.includes("adjaranett.com")) {
                headers['Referer'] = 'https://adjaranett.com/';
            } else if (decodedUrl.includes("imoviesge.com")) {
                headers['Referer'] = 'https://imoviesge.com/';
            } else {
                headers['Referer'] = 'https://ch.omegatech.app/';
                headers['Origin'] = 'https://ch.omegatech.app';
            }
        }

        const protocol = decodedUrl.startsWith('https') ? https : http;
        
        const request = protocol.get(decodedUrl, { headers, timeout: 8000 }, (proxyRes) => {
            if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
                return res.redirect(`/api/tv/img?url=${encodeURIComponent(proxyRes.headers.location)}`);
            }

            if (proxyRes.statusCode !== 200) {
                console.error(`[IMG PROXY] Error ${proxyRes.statusCode} for ${decodedUrl}`);
                return res.status(proxyRes.statusCode).end();
            }

            res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            proxyRes.pipe(res);
        });

        request.on('error', (err) => {
            console.error(`[IMG PROXY] Request error:`, err.message);
            res.status(500).end();
        });

        request.on('timeout', () => {
            request.destroy();
            res.status(504).end();
        });
    } catch (error) {
        console.error(`[IMG PROXY] Catch error:`, error.message);
        res.status(500).end();
    }
});


router.get('/tv/home', async (req, res) => {
    try {
        const data = await fetchExternal(`https://ch.omegatech.app/home`);
        res.json({ data });
    } catch (error) {
        console.error("TV Home error:", error);
        res.status(500).json({ error: "Internal server error", data: null });
    }
});

router.get('/tv/channels', async (req, res) => {
    try {
        const { cat, q, offset, limit } = req.query;
        let url = `https://ch.omegatech.app/channels?limit=${limit || 500}&offset=${offset || 0}`;
        if (cat) url += `&cat=${encodeURIComponent(cat)}`;
        if (q) url += `&q=${encodeURIComponent(q)}`;
        
        const data = await fetchExternal(url);
        
        const rawItems = data.items || data.data || (Array.isArray(data) ? data : []);
        const normalized = rawItems.map(item => {
            const rawUrl = item.streamUrl || item.stream_url || item.url || item.embedUrl || '';
            const proxiedUrl = rawUrl.startsWith('http') && !rawUrl.includes('stream.omegatech.app') 
                ? `/api/stream/proxy?url=${encodeURIComponent(rawUrl)}` 
                : rawUrl;
            return {
                id: item.id || item.channelId,
                name: item.name,
                category: item.categorySlug || item.category,
                url: proxiedUrl,
                stream_url: proxiedUrl,
                logo: item.posterUrl || item.logo || item.poster,
                thumbnail: item.posterUrl || item.thumbnail || item.poster,
                group: item.categorySlug || item.group,
                hd: item.hd,
                description: item.description
            };
        });

        res.json({ data: normalized, total: data.total || normalized.length });
    } catch (error) {
        console.error("TV Channels error:", error);
        res.status(500).json({ error: "Internal server error", data: [] });
    }
});

router.get('/tv/guide', async (req, res) => {
    try {
        const { date } = req.query;
        let url = `https://ch.omegatech.app/guide`;
        if (date) url += `?date=${date}`;
        
        const data = await fetchExternal(url);
        
        
        let flattenedPrograms = [];
        if (Array.isArray(data)) {
            data.forEach(chItem => {
                if (chItem.programs && Array.isArray(chItem.programs)) {
                    chItem.programs.forEach(prog => {
                        flattenedPrograms.push({
                            ...prog,
                            channel_id: chItem.channel?.id,
                            channel_name: chItem.channel?.name,
                            channel_logo: chItem.channel?.posterUrl
                        });
                    });
                }
            });
        }

        
        flattenedPrograms.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

        res.json({ data: flattenedPrograms });
    } catch (error) {
        console.error("TV Guide error:", error);
        res.status(500).json({ error: "Internal server error", data: [] });
    }
});

router.get('/tv/onnow', async (req, res) => {
    try {
        const data = await fetchExternal(`https://ch.omegatech.app/onnow`);
        const rawItems = Array.isArray(data) ? data : (data.data || data.items || []);
        
        const normalized = rawItems.map(item => {
            const channel = item.channel || {};
            const program = (item.programs && item.programs[0]) || item.program || item;
            
            const rawUrl = channel.streamUrl || channel.stream_url || item.stream_url || channel.url || item.url || '';
            const proxiedUrl = rawUrl.startsWith('http') && !rawUrl.includes('stream.omegatech.app')
                ? `/api/stream/proxy?url=${encodeURIComponent(rawUrl)}`
                : rawUrl;
            
            return {
                id: channel.id || item.id,
                channel_name: channel.name || item.channel_name,
                title: program.title || item.title,
                start_time: program.start || item.start || item.start_time,
                end_time: program.end || item.end || item.end_time,
                duration: program.dur || item.duration,
                logo: channel.posterUrl || channel.logo || item.logo,
                thumbnail: program.thumb || item.thumbnail || channel.posterUrl,
                stream_url: proxiedUrl,
                url: proxiedUrl
            };
        });

        res.json({ data: normalized });
    } catch (error) {
        console.error("TV OnNow error:", error);
        res.status(500).json({ error: "Internal server error", data: [] });
    }
});

router.get('/tv/matches', async (req, res) => {
    try {
        const { season } = req.query;
        let url = `https://ch.omegatech.app/matches`;
        if (season) url += `?season=${season}`;
        
        const data = await fetchExternal(url);
        const rawMatches = data.matches || (Array.isArray(data) ? data : []);
        
        const normalized = rawMatches.map(m => {
            
            const home = m.homeTeam || { name: m.home_team, crest: m.home_logo };
            const away = m.awayTeam || { name: m.away_team, crest: m.away_logo };
            const comp = m.competition || { name: m.league, emblem: m.league_logo };
            
            let scoreStr = '0 - 0';
            if (m.score?.fullTime) {
                scoreStr = `${m.score.fullTime.home ?? 0} - ${m.score.fullTime.away ?? 0}`;
            } else if (typeof m.score === 'string') {
                scoreStr = m.score;
            }

            return {
                id: m.id,
                home_team: home.name,
                away_team: away.name,
                home_logo: home.crest || home.logo,
                away_logo: away.crest || away.logo,
                score: scoreStr,
                date: m.utcDate || m.date,
                time: m.utcDate ? new Date(m.utcDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : (m.time || ''),
                status: m.status,
                league: comp.name,
                league_logo: comp.emblem || comp.logo,
                urls: (m.urls || []).map((u) => {
                    const urlVal = typeof u === 'string' ? u : u.url;
                    const proxiedUrl = urlVal.startsWith('http') && !urlVal.includes('stream.omegatech.app')
                        ? `/api/stream/proxy?url=${encodeURIComponent(urlVal)}`
                        : urlVal;
                    return { ...u, url: proxiedUrl };
                })
            };
        });

        res.json({ data: normalized });
    } catch (error) {
        console.error("TV Matches error:", error);
        res.status(500).json({ error: "Internal server error", data: [] });
    }
});

router.get('/tv/home', async (req, res) => {
    try {
        const data = await fetchExternal(`https://ch.omegatech.app/home`);
        
        if (data && data.banners) {
            data.banners = data.banners.map(b => {
                if (b.channel) {
                    const rawUrl = b.channel.streamUrl || b.channel.stream_url || b.channel.url || '';
                    if (rawUrl && rawUrl.startsWith('http') && !rawUrl.includes('stream.omegatech.app')) {
                        b.channel.streamUrl = `/api/stream/proxy?url=${encodeURIComponent(rawUrl)}`;
                        b.channel.stream_url = b.channel.streamUrl;
                    }
                }
                return b;
            });
        }

        if (data && data.onnow) {
            data.onnow = data.onnow.map(item => {
                if (item.channel) {
                    const rawUrl = item.channel.streamUrl || item.channel.stream_url || item.channel.url || '';
                    if (rawUrl && rawUrl.startsWith('http') && !rawUrl.includes('stream.omegatech.app')) {
                        item.channel.streamUrl = `/api/stream/proxy?url=${encodeURIComponent(rawUrl)}`;
                        item.channel.stream_url = item.channel.streamUrl;
                    }
                }
                return item;
            });
        }
        
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});


router.get('/live-tv', async (req, res) => {
    try {
        const cacheKey = 'live_tv_list';
        const cached = cache.get(cacheKey);
        if (cached) return res.json(cached);

        const targetUrl = 'https://omegatech-api.dixonomega.tech/api/movie/Live-Tv?action=list';
        const data = await fetchExternal(targetUrl);
        
        if (data.success && data.data) {
            
            const channels = Object.entries(data.data).map(([id, ch]) => {
                const channel = ch;
                const isOmegatechProxy = channel.url?.includes('stream.omegatech.app');
                return {
                    id,
                    ...channel,
                    url: isOmegatechProxy ? channel.url : `/api/stream/proxy?url=${encodeURIComponent(channel.url)}`
                };
            });
            
            cache.set(cacheKey, channels, 1800); 
            return res.json(channels);
        }
        
        res.json([]);
    } catch (error) {
        console.error('[API] Live TV error:', error);
        res.status(500).json({ error: "Internal server error" });
    }
});


router.get('/sport/feeds', async (req, res) => {
    try {
        const cacheKey = 'sport_feeds';
        const cached = cache.get(cacheKey);
        if (cached) return res.json(cached);

        const data = await fetchExternal('https://omegatech-api.dixonomega.tech/api/Sport/sport-feeds');
        
        
        if (data && data.success) {
            if (Array.isArray(data.matches)) {
                data.matches.forEach(m => {
                    if (m.playPath && m.playPath.startsWith('http')) {
                        m.playPath = `/api/stream/proxy?url=${encodeURIComponent(m.playPath)}`;
                    }
                    if (Array.isArray(m.playSource)) {
                        m.playSource.forEach(source => {
                            if (source.url && source.url.startsWith('http')) {
                                source.url = `/api/stream/proxy?url=${encodeURIComponent(source.url)}`;
                            }
                        });
                    }
                });
            }
            if (Array.isArray(data.highlights)) {
                data.highlights.forEach(h => {
                    if (h.path && h.path.startsWith('http')) {
                        h.path = `/api/stream/proxy?url=${encodeURIComponent(h.path)}`;
                    }
                });
            }
        }

        cache.set(cacheKey, data, 120); 
        res.json(data);
    } catch (error) {
        console.error('[API] Sports feeds error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/sport/trend', async (req, res) => {
    try {
        const { page = 1 } = req.query;
        const cacheKey = `sport_trend_page_${page}`;
        const cached = cache.get(cacheKey);
        if (cached) return res.json(cached);

        const data = await fetchExternal(`https://omegatech-api.dixonomega.tech/api/Sport/sport-trend?page=${page}&perPage=50`);
        cache.set(cacheKey, data, 300); 
        res.json(data);
    } catch (error) {
        console.error('[API] Sports trends error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/sport/match-detail', async (req, res) => {
    try {
        const { id } = req.query;
        if (!id) return res.status(400).json({ error: 'Missing id parameter' });

        const cacheKey = `sport_match_${id}`;
        const cached = cache.get(cacheKey);
        if (cached) return res.json(cached);

        const data = await fetchExternal(`https://omegatech-api.dixonomega.tech/api/Sport/match-detail?id=${id}`);
        
        
        if (data && data.success) {
            if (data.stream) {
                if (data.stream.main && data.stream.main.startsWith('http')) {
                    data.stream.main = `/api/stream/proxy?url=${encodeURIComponent(data.stream.main)}`;
                }
                if (Array.isArray(data.stream.channels)) {
                    data.stream.channels.forEach(ch => {
                        if (ch.url && ch.url.startsWith('http')) {
                            ch.url = `/api/stream/proxy?url=${encodeURIComponent(ch.url)}`;
                        }
                    });
                }
            }
            if (data.match) {
                if (data.match.playPath && data.match.playPath.startsWith('http')) {
                    data.match.playPath = `/api/stream/proxy?url=${encodeURIComponent(data.match.playPath)}`;
                }
            }
        }

        cache.set(cacheKey, data, 60); 
        res.json(data);
    } catch (error) {
        console.error('[API] Sports match detail error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


router.get('/webtoon/home', async (req, res) => {
    try {
        const cacheKey = 'webtoon_home';
        const cached = cache.get(cacheKey);
        if (cached) return res.json(cached);

        const targetUrl = 'https://omegatech-api.dixonomega.tech/api/Fun/webtoon?action=home';
        const data = await fetchExternal(targetUrl);
        
        if (data.success && data.data) {
            const result = {
                trending: data.data.trending || (Array.isArray(data.data) ? data.data : [])
            };
            cache.set(cacheKey, result, 3600);
            return res.json(result);
        }
        res.json({ trending: [] });
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get('/webtoon/search', async (req, res) => {
    const { query } = req.query;
    try {
        const targetUrl = `https://omegatech-api.dixonomega.tech/api/Fun/webtoon?action=search&query=${encodeURIComponent(query)}`;
        const data = await fetchExternal(targetUrl);
        if (data.success && data.data) {
            const result = {
                results: Array.isArray(data.data) ? data.data : (data.data.results || [])
            };
            return res.json(result);
        }
        res.json({ results: [] });
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get('/webtoon/detail', async (req, res) => {
    const { url } = req.query;
    try {
        const targetUrl = `https://omegatech-api.dixonomega.tech/api/Fun/webtoon?action=detail&url=${encodeURIComponent(url)}`;
        const data = await fetchExternal(targetUrl);
        if (data.success && data.data) {
            return res.json(data.data);
        }
        res.status(404).json({ error: "Not found" });
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get('/webtoon/read', async (req, res) => {
    const { url } = req.query;
    try {
        const targetUrl = `https://omegatech-api.dixonomega.tech/api/Fun/webtoon?action=read&url=${encodeURIComponent(url)}`;
        const data = await fetchExternal(targetUrl);
        if (data.success && data.data) {
            return res.json(data.data);
        }
        res.status(404).json({ error: "Not found" });
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});



router.get('/stream/proxy', (req, res) => {
    let targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Missing url parameter');
    
    let targetHost;
    try {
        const urlObj = new URL(targetUrl);
        targetHost = urlObj.hostname;
    } catch (e) {
        return res.status(400).send('Invalid target URL');
    }
    
    proxyStreamRequest(req, res, targetUrl, {
        'Origin': `https://${targetHost}`,
        'Referer': `https://${targetHost}/`
    });
});

router.get('/stream/:token', (req, res) => {
    const tokenOrUrl = req.params.token;
    
    
    let targetUrl = streamTokenCache.get(tokenOrUrl);
    
    
    if (!targetUrl) {
        try {
            const decoded = decodeURIComponent(tokenOrUrl);
            if (decoded.startsWith('http')) {
                targetUrl = decoded;
            }
        } catch (e) {
            
        }
    }
    
    if (!targetUrl) {
        return res.status(404).send('Stream not found or expired');
    }
    
    let targetHost;
    try {
        const urlObj = new URL(targetUrl);
        targetHost = urlObj.hostname;
    } catch (e) {
        return res.status(400).send('Invalid target URL');
    }
    
    console.log(`[STREAM PROXY] Forwarding ${tokenOrUrl.substring(0, 8)}... to ${targetHost}`);
    
    proxyStreamRequest(req, res, targetUrl, {
        'Origin': `https://${targetHost}`,
        'Referer': `https://${targetHost}/`
    });
});


router.use(['/tv', '/stream'], (req, res, next) => {
    const path = req.path;
    if (path.endsWith('.m3u8') || path.endsWith('.ts') || path.endsWith('.m3u') || path.endsWith('.key')) {
        console.warn(`[STREAM PROXY] Caught unrewritten relative path: ${path}`);
        
        
        return res.status(404).send('Not Found');
    }
    next();
});

export default router;
