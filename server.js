import express from 'express';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import https from 'https';
import { URL } from 'url';
import compression from 'compression';
import { Resvg } from '@resvg/resvg-js';
import apiRouter from './server/api.js';
import { renderOgPng } from './server/ogGenerator.js';
import { getNormalizedChannels } from './server/iptvStorage.js';
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory registry for staff/actors metadata populated from movie details
const staffMap = new Map();

// Pre-load default SLFLIX logo for OG canvas generation
let slflixLogoDataUri = '';
try {
    const logoPath = path.resolve(__dirname, 'public/icons/slflix.png');
    if (fs.existsSync(logoPath)) {
        slflixLogoDataUri = `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`;
    }
} catch (e) {
    console.warn('[Server] Could not pre-load slflix logo:', e.message);
}

// In-memory cache for generated OG PNG cards
const ogImageCache = new Map();
const app = express();
app.set('trust proxy', 1);
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const visitorData = {
    totalVisitors: 0,
    todayVisitors: 0,
    lastReset: new Date().toDateString(),
    regions: {},
    ips: new Map(),
    onlineUsers: 0,
    pageViews: {}
};
const getRegionFromIP = (ip) => {
    ip = ip.split(':').pop() || ip;
    if (ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
        return 'Local Network';
    }
    if (ip.startsWith('41.') || ip.startsWith('197.') || ip.startsWith('154.') || ip.startsWith('196.')) {
        return 'Africa';
    }
    if (ip.startsWith('92.') || ip.startsWith('188.') || ip.startsWith('91.')) {
        return 'Europe';
    }
    if (ip.startsWith('1.') || ip.startsWith('204.')) {
        return 'North America';
    }
    if (ip.startsWith('103.') || ip.startsWith('175.') || ip.startsWith('14.')) {
        return 'Asia';
    }
    if (ip.startsWith('177.') || ip.startsWith('186.') || ip.startsWith('189.')) {
        return 'South America';
    }
    if (ip.startsWith('27.') || ip.startsWith('41.')) {
        return 'Sierra Leone';
    }
    return 'Unknown';
};
const trackVisitor = (ip, page = '/') => {
    const today = new Date().toDateString();
    const cleanIP = ip.split(':').pop() || ip;
    if (visitorData.lastReset !== today) {
        visitorData.todayVisitors = 0;
        visitorData.lastReset = today;
    }
    const visitorKey = cleanIP + today;
    if (!visitorData.ips.has(visitorKey)) {
        visitorData.totalVisitors++;
        visitorData.todayVisitors++;
        visitorData.ips.set(visitorKey, {
            ip: cleanIP,
            region: getRegionFromIP(cleanIP),
            timestamp: Date.now(),
            pages: [page]
        });
        const region = getRegionFromIP(cleanIP);
        visitorData.regions[region] = (visitorData.regions[region] || 0) + 1;
    } else {
        const visitor = visitorData.ips.get(visitorKey);
        if (!visitor.pages.includes(page)) {
            visitor.pages.push(page);
        }
    }
    visitorData.pageViews[page] = (visitorData.pageViews[page] || 0) + 1;
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    for (const [key, value] of visitorData.ips) {
        if (value.timestamp < oneDayAgo) {
            visitorData.ips.delete(key);
        }
    }
};
io.on('connection', (socket) => {
    visitorData.onlineUsers++;
    io.emit('visitorUpdate', {
        onlineUsers: visitorData.onlineUsers,
        todayVisitors: visitorData.todayVisitors,
        totalVisitors: visitorData.totalVisitors
    });
    socket.on('disconnect', () => {
        visitorData.onlineUsers = Math.max(0, visitorData.onlineUsers - 1);
        io.emit('visitorUpdate', {
            onlineUsers: visitorData.onlineUsers,
            todayVisitors: visitorData.todayVisitors,
            totalVisitors: visitorData.totalVisitors
        });
    });
});
app.use((req, res, next) => {
    const clientIP = req.ip || req.connection?.remoteAddress || '127.0.0.1';
    trackVisitor(clientIP, req.path);
    next();
});
app.use(compression({
    level: 6,
    threshold: 1024,
    filter: (req) => {
        if (req.headers['x-no-compression']) return false;
        return true;
    }
}));
app.use((req, res, next) => {
    if (req.url.startsWith('/assets/') || req.path === '/index.html') {
        return next();
    }
    if (/\.(ts|tsx|map)$/.test(req.url)) {
        if (process.env.NODE_ENV !== 'production') return next();
        console.warn(`[SECURITY] Blocked source file: ${req.url}`);
        return res.status(403).send('Forbidden');
    }
    next();
});
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});
function proxyRequest(req, res, targetHost, targetPath, extraHeaders = {}) {
    if (res.headersSent) return;
    const targetUrl = `https://${targetHost}${targetPath}`;
    console.log(`[PROXY] ${req.method} ${req.url} -> ${targetUrl}`);
    const options = {
        hostname: targetHost,
        path: targetPath,
        method: req.method,
        headers: {
            ...req.headers,
            host: targetHost,
            ...extraHeaders
        },
        timeout: 15000
    };
    const proxyReq = https.request(options, (proxyRes) => {
        if (res.headersSent) return;
        if (proxyRes.statusCode && proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
            const redirectUrl = new URL(proxyRes.headers.location);
            return proxyRequest(req, res, redirectUrl.hostname, redirectUrl.pathname + redirectUrl.search, extraHeaders);
        }
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
    });
    proxyReq.on('error', (err) => {
        if (res.headersSent) return;
        console.error(`[PROXY ERROR] ${targetHost}:`, err.message);
        res.status(502).json({ code: -1, message: `Proxy error: ${err.message}` });
    });
    proxyReq.on('timeout', () => {
        if (res.headersSent) return;
        proxyReq.destroy();
        res.status(504).json({ code: -1, message: 'Proxy timeout' });
    });
    if (req.body) {
        req.pipe(proxyReq, { end: true });
    } else {
        proxyReq.end();
    }
}
const omegatechLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 60,
    message: { error: "Rate limit exceeded" },
    keyGenerator: (req) => {
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
    },
    validate: { xForwardedForHeader: false, default: false }
});
app.use('/api-omegatech', omegatechLimiter, (req, res) => {
    const pathWithoutPrefix = req.url.startsWith('/') ? req.url : '/' + req.url;
    proxyRequest(
        req, res, 
        'api.omegatech.app', 
        pathWithoutPrefix,
        {}
    );
});
app.use('/api-metadata', (req, res) => {
    const pathWithoutPrefix = req.url.startsWith('/') ? req.url : '/' + req.url;
    proxyRequest(
        req, res, 
        'h5-api.aoneroom.com', 
        '/wefeed-h5api-bff' + pathWithoutPrefix,
        { 'Origin': 'https://moviebox.ph', 'Referer': 'https://moviebox.ph/' }
    );
});
app.use('/api-player', (req, res) => {
    const pathWithoutPrefix = req.url.startsWith('/') ? req.url : '/' + req.url;
    proxyRequest(
        req, res, 
        '123movienow.cc', 
        '/wefeed-h5api-bff' + pathWithoutPrefix,
        { 'Origin': 'https://123movienow.cc', 'Referer': 'https://123movienow.cc/' }
    );
});
console.log('[PROXY] API proxies ready: metadata/player/stream');
app.use('/api', apiRouter);
// Helper for Movie / TV / Anime OG Generation
async function handleMovieOrTvOg(req, res, subjectId, forcedTheme = null) {
    if (!subjectId || subjectId.length < 2) return res.status(400).send('Invalid ID');
    const cacheKey = `og_${forcedTheme || 'auto'}_${subjectId}`;

    try {
        const apiUrl = `https://h5-api.aoneroom.com/wefeed-h5api-bff/detail?subjectId=${subjectId}`;
        let response = null;
        let retries = 2;
        while (retries >= 0) {
            try {
                response = await fetch(apiUrl, {
                    headers: { 'Origin': 'https://moviebox.ph', 'Referer': 'https://moviebox.ph/' },
                    signal: AbortSignal.timeout(4000)
                });
                if (response.ok) break;
                if (response.status === 503 && retries > 0) {
                    await new Promise(r => setTimeout(r, 800));
                    retries--;
                    continue;
                }
                break;
            } catch (e) {
                if (retries > 0) {
                    retries--;
                    await new Promise(r => setTimeout(r, 800));
                    continue;
                }
                throw e;
            }
        }

        let movie = null;
        if (response && response.ok) {
            const data = await response.json();
            movie = data.data?.subject;
        }

        // Cache staff members from this movie so staff pages can look them up instantly!
        if (movie && (movie.staffList || movie.staffs || movie.actors)) {
            const list = movie.staffList || movie.staffs || movie.actors || [];
            list.forEach(s => {
                const id = String(s.staffId || s.id || '');
                if (id) {
                    staffMap.set(id, {
                        name: s.name || s.enName || '',
                        avatar: s.avatar?.url || s.avatar || s.photo || '',
                        role: s.role || 'Actor'
                    });
                }
            });
        }

        const isTvSeries = movie?.subjectType === 2 || movie?.type === 'TV Series' || movie?.category === 'Series';
        const theme = forcedTheme || (isTvSeries ? 'tv' : 'movie');

        const title = movie?.title || movie?.name || (theme === 'tv' ? 'Featured TV Series' : 'Featured Movie');
        const posterUrl = movie?.cover?.url || movie?.thumbnail || '';
        const rating = movie?.imdbRatingValue || movie?.imdbRating || movie?.rating || '7.8';
        const year = (movie?.releaseDate || '').split('-')[0] || '2025';
        const genre = movie?.genre || movie?.category || (isTvSeries ? 'TV Series' : 'Movie');
        const description = (movie?.description || movie?.introduction || movie?.summary || '').trim();
        const duration = movie?.duration ? `${movie.duration}m` : (isTvSeries ? 'ALL SEASONS' : '4K HDR');

        const pngBuffer = await renderOgPng({
            theme: theme,
            title: title,
            description: description,
            posterUrl: posterUrl,
            rating: rating,
            year: year,
            duration: duration,
            genre: genre,
            quality: '4K ULTRA HD',
            audio: 'DOLBY AUDIO'
        }, cacheKey);

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
        res.send(pngBuffer);
    } catch (e) {
        console.error('[OG] Error generating image:', e.message);
        res.status(500).send('Error generating OG image');
    }
}

// Staff / Celebrity OG endpoint
app.get(['/api/og/staff/:staffId', '/api/og/staff/:staffId.png'], async (req, res) => {
    let staffId = (req.params.staffId || '').replace(/\.png$/, '');
    let name = req.query.name || '';
    let avatar = req.query.avatar || '';
    let role = req.query.role || '';

    if (!name && staffMap.has(staffId)) {
        const cached = staffMap.get(staffId);
        name = cached.name;
        avatar = avatar || cached.avatar;
        role = role || cached.role;
    }

    if (!name && staffId) {
        try {
            const staffApiUrl = `https://api.omegatech.app/api/movie/MovieBox-pro?action=staff&staffId=${encodeURIComponent(staffId)}&page=1`;
            const r = await fetch(staffApiUrl, { signal: AbortSignal.timeout(3000) });
            if (r.ok) {
                const d = await r.json();
                if (d.data?.staffName || d.data?.name) {
                    name = d.data.staffName || d.data.name;
                }
            }
        } catch (e) {}
    }

    if (!name) name = 'Featured Celebrity';
    if (!role) role = 'Actor / Filmmaker';

    const cacheKey = `staff_${staffId}_${name}`;

    try {
        const pngBuffer = await renderOgPng({
            theme: 'staff',
            title: name,
            description: `Explore the complete filmography, movies, and TV series starring ${name} on SLFLIX. Stream online free in ultra-high definition.`,
            posterUrl: avatar,
            role: role,
            rating: '9.2',
            genre: role
        }, cacheKey);

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
        res.send(pngBuffer);
    } catch (err) {
        console.error('[OG Staff] Error:', err);
        res.status(500).send('Error generating staff OG image');
    }
});

// TV Series OG endpoint
app.get(['/api/og/tv/:subjectId', '/api/og/tv/:subjectId.png', '/api/og/series/:subjectId', '/api/og/series/:subjectId.png'], async (req, res) => {
    let subjectId = (req.params.subjectId || '').replace(/\.png$/, '');
    await handleMovieOrTvOg(req, res, subjectId, 'tv');
});

// Movie OG endpoint
app.get(['/api/og/movie/:subjectId', '/api/og/movie/:subjectId.png'], async (req, res) => {
    let subjectId = (req.params.subjectId || '').replace(/\.png$/, '');
    await handleMovieOrTvOg(req, res, subjectId, 'movie');
});

// Live TV OG endpoint
app.get(['/api/og/live/:channelId', '/api/og/live/:channelId.png', '/api/og/live', '/api/og/live.png'], async (req, res) => {
    let channelId = (req.params.channelId || '').replace(/\.png$/, '');
    const cacheKey = `live_${channelId || 'global'}`;

    let channelName = req.query.name || 'Live TV & Sports';
    let channelLogo = req.query.logo || '';
    let category = req.query.category || 'Live Broadcast';
    let country = req.query.country || 'GLOBAL';

    if (channelId) {
        try {
            const found = getNormalizedChannels({ query: channelId, limit: 1 });
            if (found.data && found.data[0]) {
                const ch = found.data[0];
                channelName = ch.name || channelName;
                channelLogo = ch.logo || channelLogo;
                category = (ch.categories || []).join(', ') || category;
                country = ch.country || country;
            }
        } catch (e) {}
    }

    try {
        const pngBuffer = await renderOgPng({
            theme: 'live',
            title: channelName,
            description: `Watch ${channelName} live broadcast around the clock with zero buffering, multi-language commentary, and crystal clear 60FPS streaming on SLFLIX.`,
            posterUrl: channelLogo,
            year: country,
            genre: category,
            quality: '60 FPS',
            audio: 'LIVE STEREO'
        }, cacheKey);

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
        res.send(pngBuffer);
    } catch (err) {
        console.error('[OG Live] Error:', err);
        res.status(500).send('Error generating live OG image');
    }
});

// Anime OG endpoint
app.get(['/api/og/anime/:subjectId', '/api/og/anime/:subjectId.png', '/api/og/anime', '/api/og/anime.png'], async (req, res) => {
    let subjectId = (req.params.subjectId || '').replace(/\.png$/, '');
    if (subjectId) {
        await handleMovieOrTvOg(req, res, subjectId, 'anime');
    } else {
        const pngBuffer = await renderOgPng({
            theme: 'anime',
            title: 'Anime Simulcast HD',
            description: 'Stream latest anime series, movies, and OVA episodes with English subtitles and dub in 1080p full HD on SLFLIX.',
            genre: 'Anime, Action, Fantasy'
        }, 'anime_global');
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
        res.send(pngBuffer);
    }
});

// Home / Master OG endpoint
app.get(['/api/og/home', '/api/og/home.png', '/api/og', '/api/og.png'], async (req, res) => {
    try {
        const pngBuffer = await renderOgPng({
            theme: 'home',
            title: 'SLFLIX PRO Cinema Hub',
            description: 'Stream over 10,000+ blockbuster movies, binge-worthy TV series, anime, and live channels with zero ads and no registration.',
            rating: '9.8',
            year: '2026',
            genre: 'Movies, Series, Live TV',
            quality: '4K ULTRA HD'
        }, 'home_global');

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
        res.send(pngBuffer);
    } catch (err) {
        console.error('[OG Home] Error:', err);
        res.status(500).send('Error generating home OG image');
    }
});

// Generic / Backward-compatible endpoint: /api/og/:subjectId
app.get(['/api/og/:subjectId', '/api/og/:subjectId.png'], async (req, res) => {
    let subjectId = (req.params.subjectId || '').replace(/\.png$/, '');
    if (!subjectId || subjectId.length < 2) return res.status(400).send('Invalid ID');

    if (subjectId.startsWith('staff-') || subjectId.startsWith('staff_')) {
        req.params.staffId = subjectId.replace(/^staff[-_]/, '');
        const fakeReq = { ...req, params: { staffId: req.params.staffId } };
        return app._router.handle(fakeReq, res, () => {});
    }

    await handleMovieOrTvOg(req, res, subjectId);
});
app.get('/sitemap.xml', async (req, res) => {
    res.header('Content-Type', 'application/xml');
    const host = req.get('host');
    const protocol = req.protocol;
    const baseUrl = `${protocol}://${host}`;
    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
        <loc>${baseUrl}/</loc>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
    </url>
    <url>
        <loc>${baseUrl}/toplist</loc>
        <changefreq>daily</changefreq>
        <priority>0.8</priority>
    </url>
    <url>
        <loc>${baseUrl}/trending</loc>
        <changefreq>daily</changefreq>
        <priority>0.9</priority>
    </url>
    <url>
        <loc>${baseUrl}/live-tv</loc>
        <changefreq>daily</changefreq>
        <priority>0.8</priority>
    </url>
    <url>
        <loc>${baseUrl}/news</loc>
        <changefreq>daily</changefreq>
        <priority>0.8</priority>
    </url>
    <url>
        <loc>${baseUrl}/webtoon</loc>
        <changefreq>daily</changefreq>
        <priority>0.8</priority>
    </url>`;
    try {
        const categories = [
            { id: 'trending', url: 'https://h5-api.aoneroom.com/wefeed-h5api-bff/subject/trending?page=0&perPage=50' },
            { id: 'movies', url: 'https://h5-api.aoneroom.com/wefeed-h5api-bff/ranking-list/content?id=997144265920760504&page=1&perPage=50' },
            { id: 'anime', url: 'https://h5-api.aoneroom.com/wefeed-h5api-bff/ranking-list/content?id=62133389738001440&page=1&perPage=50' }
        ];
        for (const cat of categories) {
            const response = await fetch(cat.url, {
                headers: {
                    'Origin': 'https://moviebox.ph',
                    'Referer': 'https://moviebox.ph/'
                }
            });
            const data = await response.json();
            if (data.code === 0 && data.data?.subjectList) {
                data.data.subjectList.forEach(movie => {
                    const prefix = movie.type?.toLowerCase().includes('series') ? '/tv/' : '/movie/';
                    const id = movie.subjectId || movie.detailPath;
                    if (id) {
                        sitemap += `
    <url>
        <loc>${baseUrl}${prefix}${id}</loc>
        <changefreq>weekly</changefreq>
        <priority>0.6</priority>
    </url>`;
                    }
                });
            }
        }
    } catch (e) {
        console.error('[SITEMAP] Error fetching sitemap items:', e.message);
    }
    sitemap += '\n</urlset>';
    res.send(sitemap);
});
app.get('/api/visitors', (req, res) => {
    res.json({
        onlineUsers: visitorData.onlineUsers,
        todayVisitors: visitorData.todayVisitors,
        totalVisitors: visitorData.totalVisitors,
        pageViews: visitorData.pageViews
    });
});
app.get('/_i18n/:lang/messages.json', (req, res) => {
    const lang = req.params.lang || 'en';
    const messagesPath = path.join(__dirname, 'public', '_i18n', lang, 'messages.json');
    if (fs.existsSync(messagesPath)) {
        res.json(JSON.parse(fs.readFileSync(messagesPath, 'utf8')));
    } else {
        res.json({});
    }
});
app.get('/manifest.webmanifest', (req, res) => {
    const manifestPath = path.join(__dirname, 'public', 'manifest.webmanifest');
    if (fs.existsSync(manifestPath)) {
        res.json(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
    } else {
        res.json({ name: 'SLFLIX' });
    }
});
app.post('/api/event', express.json(), (req, res) => {
    const { type, data } = req.body;
    io.emit('event', { type, data, timestamp: Date.now() });
    res.json({ success: true });
});
app.get('/api/domain', (req, res) => {
    res.json({ domain: req.get('host') || 'localhost:3001' });
});
app.get(/^\/admin/, (req, res) => {
    res.status(404).json({ error: 'Route not found' });
});
app.use(async (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io') || req.path.includes('.')) {
        return next();
    }
    const isSeoRoute = req.path.startsWith('/movie/') || 
                       req.path.startsWith('/tv/') || 
                       req.path.startsWith('/series/') || 
                       req.path.startsWith('/staff/') || 
                       req.path.startsWith('/live') || 
                       req.path.startsWith('/anime') || 
                       req.path === '/';
    if (process.env.NODE_ENV === 'production' || isSeoRoute) {
        await getDynamicHtml(req, res);
    } else {
        next();
    }
});
if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
        server: { 
            middlewareMode: true,
            hmr: process.env.DISABLE_HMR === 'true' ? false : {
                port: 24678
            }
        },
        appType: 'spa',
    });
    global.viteServer = vite;
    app.use(vite.middlewares);
} else {
    app.use(express.static(path.join(__dirname, 'dist'), {
        maxAge: '1y',
        etag: true,
        setHeaders: (res, path) => {
            if (path.endsWith('.js')) res.set('Content-Type', 'application/javascript');
            if (path.endsWith('.css')) res.set('Content-Type', 'text/css');
        }
    }));
}

function injectSeoTags(html, { title, description, image, icon, url, type = 'video.movie' }) {
    if (title) {
        html = html.replace(/<title>.*?<\/title>/, `<title>${title}</title>`);
        html = html.replace(/<meta property="og:title" content=".*?"\s*\/?>/, `<meta property="og:title" content="${title}">`);
        html = html.replace(/<meta name="twitter:title" content=".*?"\s*\/?>/, `<meta name="twitter:title" content="${title}">`);
    }
    if (description) {
        html = html.replace(/<meta name="description" content=".*?"\s*\/?>/, `<meta name="description" content="${description}">`);
        html = html.replace(/<meta property="og:description" content=".*?"\s*\/?>/, `<meta property="og:description" content="${description}">`);
        html = html.replace(/<meta name="twitter:description" content=".*?"\s*\/?>/, `<meta name="twitter:description" content="${description}">`);
    }
    if (image) {
        html = html.replace(/<meta property="og:image" content=".*?"\s*\/?>/, `<meta property="og:image" content="${image}">\n    <meta property="og:image:type" content="image/png">\n    <meta property="og:image:width" content="1200">\n    <meta property="og:image:height" content="630">`);
        html = html.replace(/<meta name="twitter:image" content=".*?"\s*\/?>/, `<meta name="twitter:image" content="${image}">`);
    }
    if (type) {
        html = html.replace(/<meta property="og:type" content=".*?"\s*\/?>/, `<meta property="og:type" content="${type}">`);
    }
    if (url) {
        html = html.replace(/<meta property="og:url" content=".*?"\s*\/?>/, `<meta property="og:url" content="${url}">`);
        if (html.includes('rel="canonical"')) {
            html = html.replace(/rel="canonical" href=".*?"/, `rel="canonical" href="${url}"`);
        } else {
            html = html.replace('</head>', `<link rel="canonical" href="${url}" />\n</head>`);
        }
    }
    if (icon) {
        html = html.replace(/<link rel="icon"[^>]*>/, `<link rel="icon" type="image/jpeg" href="${icon}">`);
        html = html.replace(/<link rel="shortcut icon"[^>]*>/, `<link rel="shortcut icon" type="image/jpeg" href="${icon}">`);
        html = html.replace(/<link rel="apple-touch-icon"[^>]*>/, `<link rel="apple-touch-icon" href="${icon}">`);
    }
    return html;
}

async function getDynamicHtml(req, res) {
    const pathParts = req.path.split('/').filter(Boolean);
    const section = pathParts[0] || '';
    const subjectId = pathParts[1] || '';

    const isMovie = section === 'movie';
    const isTv = section === 'tv' || section === 'series';
    const isStaff = section === 'staff';
    const isLive = section === 'live' || section === 'live-tv';
    const isAnime = section === 'anime';
    const isHome = pathParts.length === 0;

    let htmlPath = process.env.NODE_ENV === 'production' 
        ? path.join(__dirname, 'dist', 'index.html')
        : path.join(__dirname, 'index.html');
    if (!fs.existsSync(htmlPath)) {
        return res.sendFile(htmlPath);
    }
    let html = fs.readFileSync(htmlPath, 'utf8');
    const hostUrl = `${req.protocol}://${req.get('host')}`;
    const fullUrl = `${hostUrl}${req.originalUrl}`;

    try {
        if ((isMovie || isTv) && subjectId && subjectId.length > 5) {
            const apiUrl = `https://h5-api.aoneroom.com/wefeed-h5api-bff/detail?subjectId=${subjectId}`;
            let response;
            let retries = 2;
            while (retries >= 0) {
                try {
                    response = await fetch(apiUrl, {
                        headers: {
                            'Origin': 'https://moviebox.ph',
                            'Referer': 'https://moviebox.ph/'
                        },
                        signal: AbortSignal.timeout(4000)
                    });
                    if (response.ok) break;
                    if (response.status === 503 && retries > 0) {
                        await new Promise(resolve => setTimeout(resolve, 800));
                        retries--;
                        continue;
                    }
                    break;
                } catch (e) {
                    if (retries > 0) {
                        retries--;
                        await new Promise(resolve => setTimeout(resolve, 800));
                        continue;
                    }
                    throw e;
                }
            }
            if (response && response.ok) {
                const data = await response.json();
                if (data.code === 0 && data.data && data.data.subject) {
                    const movie = data.data.subject;
                    const isTvSeries = isTv || movie.subjectType === 2 || movie.type === 'TV Series';
                    const rawTitle = isTvSeries 
                        ? `${movie.title} | Stream TV Series Online Free - SLFLIX`
                        : `${movie.title} | Watch Online Free - SLFLIX`;
                    const movieOwnDesc = (movie.description || '').trim();
                    const rawDescription = movieOwnDesc || `Watch ${movie.title} online free in HD. ${movie.genre || 'Stream now on SLFLIX'}.`;
                    const title = rawTitle.replace(/"/g, '&quot;');
                    const description = rawDescription.replace(/"/g, '&quot;').replace(/[\r\n]+/g, ' ');
                    const image = `${hostUrl}/api/og/${isTvSeries ? 'tv' : 'movie'}/${subjectId}.png`;
                    const movieCoverUrl = movie.cover?.url || movie.thumbnail || `${hostUrl}/icons/slflix.png`;

                    // Cache staff members for future staff page requests
                    if (movie.staffList || movie.staffs || movie.actors) {
                        const list = movie.staffList || movie.staffs || movie.actors || [];
                        list.forEach(s => {
                            const sId = String(s.staffId || s.id || '');
                            if (sId) {
                                staffMap.set(sId, {
                                    name: s.name || s.enName || '',
                                    avatar: s.avatar?.url || s.avatar || s.photo || '',
                                    role: s.role || 'Actor'
                                });
                            }
                        });
                    }

                    html = injectSeoTags(html, {
                        title,
                        description,
                        image,
                        icon: movieCoverUrl,
                        url: fullUrl,
                        type: isTvSeries ? 'video.tv_show' : 'video.movie'
                    });
                }
            }
        } else if (isStaff && subjectId) {
            let staffInfo = staffMap.get(subjectId);
            if (!staffInfo) {
                try {
                    const sRes = await fetch(`https://api.omegatech.app/api/movie/MovieBox-pro?action=staff&staffId=${encodeURIComponent(subjectId)}&page=1`, {
                        signal: AbortSignal.timeout(3000)
                    });
                    if (sRes.ok) {
                        const sData = await sRes.json();
                        if (sData.data?.staffName || sData.data?.name) {
                            staffInfo = {
                                name: sData.data.staffName || sData.data.name,
                                avatar: sData.data.avatar || sData.data.photo || '',
                                role: 'Actor'
                            };
                            staffMap.set(subjectId, staffInfo);
                        }
                    }
                } catch (e) {}
            }

            const staffName = staffInfo?.name || 'Celebrity Talent';
            const title = `${staffName} | Filmography & Works - SLFLIX`.replace(/"/g, '&quot;');
            const description = `Explore all movies, series, and releases starring ${staffName} on SLFLIX. Watch online free in ultra-high definition.`.replace(/"/g, '&quot;');
            const image = `${hostUrl}/api/og/staff/${subjectId}.png?name=${encodeURIComponent(staffName)}`;
            const iconUrl = staffInfo?.avatar || `${hostUrl}/icons/slflix.png`;

            html = injectSeoTags(html, {
                title,
                description,
                image,
                icon: iconUrl,
                url: fullUrl,
                type: 'profile'
            });
        } else if (isLive) {
            const title = 'Live TV Online Free | 24/7 Global Channels & Sports - SLFLIX';
            const description = 'Stream over 1,500+ premium live television channels, sports, and global news free in HD with zero delay on SLFLIX.';
            const image = `${hostUrl}/api/og/live.png`;

            html = injectSeoTags(html, {
                title,
                description,
                image,
                icon: `${hostUrl}/icons/slflix.png`,
                url: fullUrl,
                type: 'video.other'
            });
        } else if (isAnime) {
            const title = 'Watch Anime Online Free in HD | Sub & Dub - SLFLIX';
            const description = 'Stream popular anime series, movies, and simulcasts with English sub and dub in 1080p HD on SLFLIX.';
            const image = `${hostUrl}/api/og/anime.png`;

            html = injectSeoTags(html, {
                title,
                description,
                image,
                icon: `${hostUrl}/icons/slflix.png`,
                url: fullUrl,
                type: 'video.tv_show'
            });
        } else if (isHome) {
            const title = 'SLFLIX | Watch Free Movies, TV Series & Live Streams Online in 4K';
            const description = 'Stream over 10,000+ blockbuster movies, binge-worthy TV series, anime, and live channels with zero ads and no registration.';
            const image = `${hostUrl}/api/og/home.png`;

            html = injectSeoTags(html, {
                title,
                description,
                image,
                icon: `${hostUrl}/icons/slflix.png`,
                url: fullUrl,
                type: 'website'
            });
        }
    } catch (e) {
        console.error('[SEO] Error fetching dynamic details:', e.message);
    }

    if (process.env.NODE_ENV !== 'production' && global.viteServer) {
        try {
            html = await global.viteServer.transformIndexHtml(req.originalUrl, html);
        } catch (e) {
            console.error('[Vite] Transform error:', e);
        }
    }
    res.send(html);
}
const PORT = 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 SLFLIX Server running on http://localhost:${PORT}`);
    console.log(`📊 Full production app ready!`);
});
export default app;