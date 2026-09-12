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
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
app.get(['/api/og/:subjectId', '/api/og/:subjectId.png'], async (req, res) => {
    let subjectId = req.params.subjectId || '';
    if (subjectId.endsWith('.png')) {
        subjectId = subjectId.replace(/\.png$/, '');
    }
    if (!subjectId || subjectId.length < 3) return res.status(400).send('Invalid ID');

    // Check memory cache for instant response (<1ms)
    if (ogImageCache.has(subjectId)) {
        const cachedPng = ogImageCache.get(subjectId);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
        return res.send(cachedPng);
    }

    try {
        const apiUrl = `https://h5-api.aoneroom.com/wefeed-h5api-bff/detail?subjectId=${subjectId}`;
        let response = null;
        let retries = 2;
        while (retries >= 0) {
            try {
                response = await fetch(apiUrl, {
                    headers: { 'Origin': 'https://moviebox.ph', 'Referer': 'https://moviebox.ph/' }
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

        let movie = null;
        if (response && response.ok) {
            const data = await response.json();
            movie = data.data?.subject;
        }

        const rawTitle = movie?.title || 'SLFLIX Movie';
        const title = rawTitle.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const posterUrl = movie?.cover?.url || movie?.thumbnail;
        
        let posterDataUri = '';
        if (posterUrl) {
            try {
                const imgRes = await fetch(posterUrl);
                if (imgRes.ok) {
                    const buf = await imgRes.arrayBuffer();
                    const mime = imgRes.headers.get('content-type') || 'image/jpeg';
                    posterDataUri = `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;
                }
            } catch (e) {
                console.warn('[OG] Failed fetching poster image:', e.message);
            }
        }
        if (!posterDataUri) {
            posterDataUri = slflixLogoDataUri;
        }

        const rating = movie?.imdbRatingValue || movie?.imdbRating || movie?.rating || '6.8';
        const year = (movie?.releaseDate || '').split('-')[0] || '2025';
        const rawGenre = movie?.genre || movie?.category || 'Movie';
        const genre = rawGenre.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const type = (movie?.subjectType === 2 || movie?.type === 'TV Series' || movie?.category === 'Series') ? 'TV Series' : 'Movie';

        const fontSize = title.length > 22 ? 46 : (title.length > 14 ? 54 : 68);

        const svg = `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#080914" />
      <stop offset="100%" stop-color="#0e0f1e" />
    </linearGradient>
    <linearGradient id="dividerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#00e5ff" />
      <stop offset="100%" stop-color="#f40af0" />
    </linearGradient>
    <filter id="posterShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#000000" flood-opacity="0.75" />
    </filter>
    <clipPath id="posterClip">
      <rect x="80" y="65" width="340" height="500" rx="24" />
    </clipPath>
    <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
      <path d="M 60 0 L 0 0 0 60" fill="none" stroke="white" stroke-width="0.5" stroke-opacity="0.04" />
    </pattern>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)" />
  <rect width="1200" height="630" fill="url(#grid)" />

  <!-- Ambient Glow -->
  <circle cx="1100" cy="120" r="280" fill="#00e5ff" fill-opacity="0.04" />
  <circle cx="100" cy="520" r="240" fill="#f40af0" fill-opacity="0.03" />

  <!-- Poster Card -->
  <g filter="url(#posterShadow)">
    <rect x="80" y="65" width="340" height="500" rx="24" fill="#181928" stroke="white" stroke-opacity="0.15" stroke-width="1.5" />
    ${posterDataUri ? `<image href="${posterDataUri}" x="80" y="65" width="340" height="500" preserveAspectRatio="xMidYMid slice" clip-path="url(#posterClip)" />` : ''}
  </g>

  <!-- Top Right Brand / Logo -->
  <g transform="translate(1040, 65)">
    <rect width="76" height="76" rx="18" fill="#0f1122" stroke="white" stroke-opacity="0.12" stroke-width="1" />
    ${slflixLogoDataUri ? `<image href="${slflixLogoDataUri}" x="10" y="10" width="56" height="56" />` : ''}
  </g>

  <!-- Content Section -->
  <g transform="translate(470, 115)">
    <!-- Category / Tagline -->
    <text x="0" y="0" font-family="sans-serif" font-size="20" font-weight="800" fill="#00e5ff" letter-spacing="4">SLFLIX PRO PREMIUM</text>

    <!-- Main Title -->
    <text x="0" y="80" font-family="sans-serif" font-size="${fontSize}" font-weight="900" fill="#ffffff">${title}</text>

    <!-- Badges Row -->
    <g transform="translate(0, 125)">
      <!-- Rating Badge -->
      <rect x="0" y="0" width="100" height="44" rx="12" fill="#00e5ff" />
      <text x="50" y="30" font-family="sans-serif" font-size="22" font-weight="800" fill="#000000" text-anchor="middle">★ ${rating}</text>

      <!-- Year Badge -->
      <rect x="116" y="0" width="95" height="44" rx="12" fill="white" fill-opacity="0.08" stroke="white" stroke-opacity="0.2" stroke-width="1" />
      <text x="163" y="30" font-family="sans-serif" font-size="22" font-weight="700" fill="#ffffff" text-anchor="middle">${year}</text>

      <!-- Type Badge -->
      <rect x="227" y="0" width="130" height="44" rx="12" fill="white" fill-opacity="0.08" stroke="white" stroke-opacity="0.2" stroke-width="1" />
      <text x="292" y="30" font-family="sans-serif" font-size="22" font-weight="700" fill="#ffffff" text-anchor="middle">${type}</text>
    </g>

    <!-- Genre -->
    <text x="0" y="225" font-family="sans-serif" font-size="30" font-weight="500" fill="#9ca3af">${genre}</text>

    <!-- Divider Line -->
    <rect x="0" y="260" width="620" height="2" fill="url(#dividerGrad)" />

    <!-- Promotional Subtitle -->
    <text x="0" y="315" font-family="sans-serif" font-size="23" font-style="italic" fill="#8892b0">Stream unlimited movies and series in 4K resolution.</text>
    <text x="0" y="355" font-family="sans-serif" font-size="23" font-style="italic" fill="#8892b0">Experience cinema at home with SLFLIX.</text>
  </g>
</svg>`;

        if (req.query.format === 'svg') {
            res.setHeader('Content-Type', 'image/svg+xml');
            res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
            return res.send(svg);
        }

        const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } });
        const pngBuffer = resvg.render().asPng();

        // Save to cache (cap size at 500)
        if (ogImageCache.size > 500) {
            const firstKey = ogImageCache.keys().next().value;
            ogImageCache.delete(firstKey);
        }
        ogImageCache.set(subjectId, pngBuffer);

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
        res.send(pngBuffer);
    } catch (e) {
        console.error('[OG] Error generating image:', e);
        res.status(500).send('Error generating OG image');
    }
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
    if (process.env.NODE_ENV === 'production' || req.path.startsWith('/movie/') || req.path.startsWith('/tv/')) {
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
async function getDynamicHtml(req, res) {
    const pathParts = req.path.split('/').filter(Boolean);
    const isMovie = pathParts[0] === 'movie';
    const isTv = pathParts[0] === 'tv';
    const subjectId = pathParts[1];
    let htmlPath = process.env.NODE_ENV === 'production' 
        ? path.join(__dirname, 'dist', 'index.html')
        : path.join(__dirname, 'index.html');
    if (!fs.existsSync(htmlPath)) {
        return res.sendFile(htmlPath);
    }
    let html = fs.readFileSync(htmlPath, 'utf8');
    if ((isMovie || isTv) && subjectId && subjectId.length > 5) {
        try {
            const apiUrl = `https://h5-api.aoneroom.com/wefeed-h5api-bff/detail?subjectId=${subjectId}`;
            let response;
            let retries = 2;
            while (retries >= 0) {
                try {
                    response = await fetch(apiUrl, {
                        headers: {
                            'Origin': 'https://moviebox.ph',
                            'Referer': 'https://moviebox.ph/'
                        }
                    });
                    if (response.ok) break;
                    if (response.status === 503 && retries > 0) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        retries--;
                        continue;
                    }
                    break;
                } catch (e) {
                    if (retries > 0) {
                        retries--;
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        continue;
                    }
                    throw e;
                }
            }
            if (response && response.ok) {
                const data = await response.json();
                if (data.code === 0 && data.data && data.data.subject) {
                    const movie = data.data.subject;
                    const rawTitle = `${movie.title} | Watch Online Free - SLFLIX`;
                    const movieOwnDesc = (movie.description || '').trim();
                    const rawDescription = movieOwnDesc || `Watch ${movie.title} online free in HD. ${movie.genre || 'Stream now on SLFLIX'}.`;
                    const title = rawTitle.replace(/"/g, '&quot;');
                    const description = rawDescription.replace(/"/g, '&quot;').replace(/\n/g, ' ').replace(/\r/g, '');
                    const hostUrl = `${req.protocol}://${req.get('host')}`;
                    const image = `${hostUrl}/api/og/${subjectId}.png`;
                    const movieCoverUrl = movie.cover?.url || movie.thumbnail || `${hostUrl}/icons/slflix.png`;
                    const url = `${hostUrl}${req.originalUrl}`;
                    html = html.replace(/<title>.*?<\/title>/, `<title>${title}</title>`);
                    html = html.replace(/<meta name="description" content=".*?"\s*\/?>/, `<meta name="description" content="${description}">`);
                    html = html.replace(/<meta property="og:title" content=".*?"\s*\/?>/, `<meta property="og:title" content="${title}">`);
                    html = html.replace(/<meta property="og:description" content=".*?"\s*\/?>/, `<meta property="og:description" content="${description}">`);
                    html = html.replace(/<meta property="og:image" content=".*?"\s*\/?>/, `<meta property="og:image" content="${image}">\n    <meta property="og:image:type" content="image/png">\n    <meta property="og:image:width" content="1200">\n    <meta property="og:image:height" content="630">`);
                    html = html.replace(/<meta property="og:type" content=".*?"\s*\/?>/, `<meta property="og:type" content="${isTv ? 'video.tv_show' : 'video.movie'}">`);
                    html = html.replace(/<meta property="og:url" content=".*?"\s*\/?>/, `<meta property="og:url" content="${url}">`);
                    html = html.replace(/<meta name="twitter:title" content=".*?"\s*\/?>/, `<meta name="twitter:title" content="${title}">`);
                    html = html.replace(/<meta name="twitter:description" content=".*?"\s*\/?>/, `<meta name="twitter:description" content="${description}">`);
                    html = html.replace(/<meta name="twitter:image" content=".*?"\s*\/?>/, `<meta name="twitter:image" content="${image}">`);
                    html = html.replace(/<link rel="icon"[^>]*>/, `<link rel="icon" type="image/jpeg" href="${movieCoverUrl}">`);
                    html = html.replace(/<link rel="shortcut icon"[^>]*>/, `<link rel="shortcut icon" type="image/jpeg" href="${movieCoverUrl}">`);
                    html = html.replace(/<link rel="apple-touch-icon"[^>]*>/, `<link rel="apple-touch-icon" href="${movieCoverUrl}">`);
                    if (html.includes('rel="canonical"')) {
                        html = html.replace(/rel="canonical" href=".*?"/, `rel="canonical" href="${url}"`);
                    } else {
                        html = html.replace('</head>', `<link rel="canonical" href="${url}" />\n</head>`);
                    }
                }
            }
        } catch (e) {
            console.error('[SEO] Error fetching movie details:', e.message);
        }
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