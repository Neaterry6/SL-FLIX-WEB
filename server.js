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
const watchRooms = new Map();

function getRoomCurrentTime(room) {
    if (!room) return 0;
    if (room.paused) return room.currentTime || 0;
    const elapsed = (Date.now() - (room.updatedAt || Date.now())) / 1000;
    return Math.max(0, (room.currentTime || 0) + elapsed);
}

function getActiveRoomsList() {
    return Array.from(watchRooms.values()).map(r => ({
        ...r,
        currentTime: getRoomCurrentTime(r)
    }));
}

function broadcastActiveRooms() {
    io.emit('active_rooms_list', getActiveRoomsList());
}

setInterval(() => {
    const oneDay = 24 * 60 * 60 * 1000;
    const now = Date.now();
    for (const [roomId, room] of watchRooms.entries()) {
        if (now - room.updatedAt > oneDay) {
            watchRooms.delete(roomId);
        }
    }
}, 60 * 60 * 1000);

io.on('connection', (socket) => {
    visitorData.onlineUsers++;
    io.emit('visitorUpdate', {
        onlineUsers: visitorData.onlineUsers,
        todayVisitors: visitorData.todayVisitors,
        totalVisitors: visitorData.totalVisitors
    });

    socket.on('get_active_rooms', () => {
        socket.emit('active_rooms_list', getActiveRoomsList());
    });

    socket.on('create_room', ({ roomId, roomName, username, movie, season, episode }) => {
        socket.join(roomId);
        const now = Date.now();
        const room = {
            roomId,
            roomName: roomName || `Room ${roomId}`,
            creator: username,
            movie: movie || null,
            currentSeason: season || 1,
            currentEpisode: episode || 1,
            users: [{ id: socket.id, name: username, isCreator: true }],
            currentTime: 0,
            paused: false, // Starts playing continuous real-time movie stream
            updatedAt: now
        };
        watchRooms.set(roomId, room);
        broadcastActiveRooms();
        socket.emit('room_state', room);
    });

    socket.on('join_room', ({ roomId, username }) => {
        socket.join(roomId);
        const room = watchRooms.get(roomId);
        if (room) {
            const currentComputedTime = getRoomCurrentTime(room);
            if (!room.users.some(u => u.name === username)) {
                room.users.push({ id: socket.id, name: username, isCreator: room.creator === username });
            }
            // Real-time continuous synchronized room state
            const syncPayload = {
                ...room,
                currentTime: currentComputedTime
            };
            io.to(roomId).emit('room_state', syncPayload);
            broadcastActiveRooms();
        } else {
            socket.emit('error_message', { message: 'Room not found or expired' });
        }
    });

    socket.on('leave_room', ({ roomId, username }) => {
        socket.leave(roomId);
        const room = watchRooms.get(roomId);
        if (room) {
            room.users = room.users.filter(u => u.id !== socket.id && u.name !== username);
            // Continuous movie playback continues for room even if users leave!
            io.to(roomId).emit('room_user_left', { username, usersCount: room.users.length });
            broadcastActiveRooms();
        }
    });

    socket.on('room_action', ({ roomId, action, currentTime, paused, movie, season, episode, username }) => {
        const room = watchRooms.get(roomId);
        if (room) {
            const now = Date.now();
            if (currentTime !== undefined) {
                room.currentTime = currentTime;
            } else if (!room.paused) {
                room.currentTime = getRoomCurrentTime(room);
            }
            if (paused !== undefined) {
                room.paused = paused;
            }
            if (movie) room.movie = movie;
            if (season !== undefined) room.currentSeason = season;
            if (episode !== undefined) room.currentEpisode = episode;
            room.updatedAt = now;

            io.to(roomId).emit('room_sync', { 
                action, 
                currentTime: room.currentTime, 
                paused: room.paused, 
                movie: room.movie, 
                season: room.currentSeason,
                episode: room.currentEpisode,
                username 
            });
            broadcastActiveRooms();
        }
    });

    socket.on('room_chat', ({ roomId, username, message }) => {
        io.to(roomId).emit('room_chat_message', { username, message, timestamp: Date.now() });
    });

    socket.on('disconnect', () => {
        visitorData.onlineUsers = Math.max(0, visitorData.onlineUsers - 1);
        for (const [roomId, room] of watchRooms.entries()) {
            const beforeCount = room.users.length;
            room.users = room.users.filter(u => u.id !== socket.id);
            if (room.users.length !== beforeCount) {
                io.to(roomId).emit('room_sync', {
                    action: 'user_disconnect',
                    currentTime: getRoomCurrentTime(room),
                    paused: room.paused,
                    movie: room.movie,
                    season: room.currentSeason,
                    episode: room.currentEpisode,
                    usersCount: room.users.length
                });
            }
        }
        broadcastActiveRooms();
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
// Helper to dynamically extract the host and protocol regardless of proxy / Cloud Run
function getBaseUrl(req) {
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
    const host = (req.headers['x-forwarded-host'] || req.headers['host'] || req.get('host') || 'localhost:3000').split(',')[0].trim();
    return `${proto}://${host}`;
}

// Robust fallback movie detail fetcher
async function fetchSubjectDetails(subjectId) {
    if (!subjectId) return null;
    const cleanId = String(subjectId).trim().replace(/\.png$/i, '');

    // 1. Try Omegatech API if numeric
    if (/^\d+$/.test(cleanId)) {
        try {
            const omRes = await fetch(`https://api.omegatech.app/api/movie/MovieBox-pro?action=detail&subjectId=${encodeURIComponent(cleanId)}`, {
                signal: AbortSignal.timeout(3500)
            });
            if (omRes.ok) {
                const data = await omRes.json();
                if (data?.data?.subject) return data.data.subject;
            }
        } catch (e) {}
    }

    // 2. Try aoneroom BFF
    try {
        const queryParam = /^\d+$/.test(cleanId) ? `subjectId=${encodeURIComponent(cleanId)}` : `detailPath=${encodeURIComponent(cleanId)}`;
        const h5Res = await fetch(`https://h5-api.aoneroom.com/wefeed-h5api-bff/detail?${queryParam}`, {
            headers: { 'Origin': 'https://moviebox.ph', 'Referer': 'https://moviebox.ph/' },
            signal: AbortSignal.timeout(3500)
        });
        if (h5Res.ok) {
            const data = await h5Res.json();
            if (data?.data?.subject) return data.data.subject;
        }
    } catch (e) {}

    return null;
}

// Default fallback poster for when none is found
const DEFAULT_OG_POSTER = 'https://pbcdnw.aoneroom.com/image/2023/08/10/d1a46b5a-e7c6-43f1-bdf0-c8f35e985854.jpg';

// Helper for Movie / TV / Anime OG Generation
async function handleMovieOrTvOg(req, res, subjectId, forcedTheme = null) {
    if (!subjectId || subjectId.length < 2) return res.status(400).send('Invalid ID');
    const cleanId = String(subjectId).trim().replace(/\.png$/i, '');
    const cacheKey = `og_${forcedTheme || 'auto'}_${cleanId}`;

    try {
        const movie = await fetchSubjectDetails(cleanId);

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
        const posterUrl = movie?.cover?.url || movie?.thumbnail || DEFAULT_OG_POSTER;
        const rating = movie?.imdbRatingValue || movie?.imdbRating || movie?.rating || '8.5';
        const year = (movie?.releaseDate || '').split('-')[0] || '2026';
        const genre = movie?.genre || movie?.category || (isTvSeries ? 'TV Series' : 'Movie');
        const description = (movie?.description || movie?.introduction || movie?.summary || 'Watch online free in ultra-high definition on SLFLIX with zero ads.').trim();
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

// Novel OG endpoint
app.get(['/api/og/novel/:novelId', '/api/og/novel/:novelId.png', '/api/og/novel', '/api/og/novel.png', '/api/og/novels.png'], async (req, res) => {
    try {
        let novelId = (req.params.novelId || '').replace(/\.png$/, '');
        let title = req.query.title || 'SLFLIX Novel Hub';
        let author = req.query.author || 'Popular Author';
        let cover = req.query.cover || '';
        let score = req.query.score || '8.5';
        let views = req.query.views || '12K';

        if (novelId && (!req.query.title || !cover)) {
            try {
                const nRes = await fetch(`https://api.omegatech.app/api/Novel/novel?action=detail&novelId=${encodeURIComponent(novelId)}`, {
                    signal: AbortSignal.timeout(3000)
                });
                if (nRes.ok) {
                    const nData = await nRes.json();
                    if (nData.data || nData.result || nData.novel) {
                        const info = nData.data || nData.result || nData.novel;
                        title = info.title || title;
                        author = info.author || author;
                        cover = info.cover || cover;
                        score = info.score || score;
                        views = info.totalViews || views;
                    }
                }
            } catch (e) {}
        }

        const pngBuffer = await renderOgPng({
            theme: 'novel',
            title: title,
            description: `Read "${title}" by ${author} on SLFLIX Novel Hub. Immersive reading, auto-scroll and full chapters online.`,
            posterUrl: cover || 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=800',
            rating: score,
            year: `${views} Views`,
            genre: 'Romance, Fantasy, Action',
            quality: 'FULL CHAPTERS'
        }, `novel_${novelId || 'global'}`);

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
        res.send(pngBuffer);
    } catch (err) {
        console.error('[OG Novel] Error:', err);
        res.status(500).send('Error generating novel OG image');
    }
});

// Home / Master OG endpoint
app.get(['/api/og/home', '/api/og/home.png', '/api/og', '/api/og.png'], async (req, res) => {
    try {
        const pngBuffer = await renderOgPng({
            theme: 'home',
            title: 'SLFLIX PRO Cinema Hub',
            description: 'Stream over 10,000+ blockbuster movies, binge-worthy TV series, anime, and live channels with zero ads and no registration.',
            posterUrl: DEFAULT_OG_POSTER,
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

// Robots.txt dynamic handler with host auto-detection
app.get('/robots.txt', (req, res) => {
    const baseUrl = getBaseUrl(req);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(`User-agent: *
Allow: /
Disallow: /api/

Sitemap: ${baseUrl}/sitemap.xml
`);
});

// Sitemap in-memory cache
const sitemapCache = new Map();

// Dynamic Sitemap generator with host auto-detection
app.get('/sitemap.xml', async (req, res) => {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=3600');
    const baseUrl = getBaseUrl(req);

    const cached = sitemapCache.get(baseUrl);
    if (cached && Date.now() < cached.expiresAt) {
        return res.send(cached.xml);
    }

    const today = new Date().toISOString().split('T')[0];
    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
        <loc>${baseUrl}/</loc>
        <lastmod>${today}</lastmod>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
    </url>
    <url>
        <loc>${baseUrl}/trending</loc>
        <lastmod>${today}</lastmod>
        <changefreq>daily</changefreq>
        <priority>0.9</priority>
    </url>
    <url>
        <loc>${baseUrl}/toplist</loc>
        <lastmod>${today}</lastmod>
        <changefreq>daily</changefreq>
        <priority>0.8</priority>
    </url>
    <url>
        <loc>${baseUrl}/live-tv</loc>
        <lastmod>${today}</lastmod>
        <changefreq>daily</changefreq>
        <priority>0.8</priority>
    </url>
    <url>
        <loc>${baseUrl}/news</loc>
        <lastmod>${today}</lastmod>
        <changefreq>daily</changefreq>
        <priority>0.7</priority>
    </url>
    <url>
        <loc>${baseUrl}/sports</loc>
        <lastmod>${today}</lastmod>
        <changefreq>daily</changefreq>
        <priority>0.7</priority>
    </url>
    <url>
        <loc>${baseUrl}/webtoon</loc>
        <lastmod>${today}</lastmod>
        <changefreq>daily</changefreq>
        <priority>0.7</priority>
    </url>
    <url>
        <loc>${baseUrl}/staff</loc>
        <lastmod>${today}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>0.6</priority>
    </url>
    <url>
        <loc>${baseUrl}/api-docs</loc>
        <lastmod>${today}</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.5</priority>
    </url>`;

    try {
        const categories = [
            { id: 'trending', url: 'https://h5-api.aoneroom.com/wefeed-h5api-bff/subject/trending?page=0&perPage=50' },
            { id: 'movies', url: 'https://h5-api.aoneroom.com/wefeed-h5api-bff/ranking-list/content?id=997144265920760504&page=1&perPage=50' },
            { id: 'anime', url: 'https://h5-api.aoneroom.com/wefeed-h5api-bff/ranking-list/content?id=62133389738001440&page=1&perPage=50' }
        ];

        const seenIds = new Set();

        for (const cat of categories) {
            try {
                const response = await fetch(cat.url, {
                    headers: { 'Origin': 'https://moviebox.ph', 'Referer': 'https://moviebox.ph/' },
                    signal: AbortSignal.timeout(3000)
                });
                if (response.ok) {
                    const data = await response.json();
                    if (data.code === 0 && data.data?.subjectList) {
                        data.data.subjectList.forEach(movie => {
                            const prefix = movie.type?.toLowerCase().includes('series') ? '/tv/' : '/movie/';
                            const id = movie.subjectId || movie.detailPath;
                            if (id && !seenIds.has(id)) {
                                seenIds.add(id);
                                sitemap += `
    <url>
        <loc>${baseUrl}${prefix}${id}</loc>
        <lastmod>${today}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>0.7</priority>
    </url>`;
                            }
                        });
                    }
                }
            } catch (err) {}
        }

        // Also query Omegatech popular releases if possible
        try {
            const omRes = await fetch('https://api.omegatech.app/api/movie/MovieBox-pro?action=search&keyword=a&page=1', {
                signal: AbortSignal.timeout(3000)
            });
            if (omRes.ok) {
                const omData = await omRes.json();
                const results = omData.data?.results || omData.data?.items || [];
                results.forEach(m => {
                    const id = m.subjectId || m.detailPath;
                    if (id && !seenIds.has(id)) {
                        seenIds.add(id);
                        const isSeries = m.subjectType === 2 || (m.type && m.type.toLowerCase().includes('series'));
                        sitemap += `
    <url>
        <loc>${baseUrl}${isSeries ? '/tv/' : '/movie/'}${id}</loc>
        <lastmod>${today}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>0.7</priority>
    </url>`;
                    }
                });
            }
        } catch (omErr) {}
    } catch (e) {
        console.error('[SITEMAP] Error fetching sitemap items:', e.message);
    }

    sitemap += '\n</urlset>';
    sitemapCache.set(baseUrl, { xml: sitemap, expiresAt: Date.now() + 15 * 60 * 1000 });
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
    const isNovel = section === 'novel' || section === 'novels';
    const isHome = pathParts.length === 0;

    let htmlPath = process.env.NODE_ENV === 'production' 
        ? path.join(__dirname, 'dist', 'index.html')
        : path.join(__dirname, 'index.html');
    if (!fs.existsSync(htmlPath)) {
        return res.sendFile(htmlPath);
    }
    let html = fs.readFileSync(htmlPath, 'utf8');
    const hostUrl = getBaseUrl(req);
    const fullUrl = `${hostUrl}${req.originalUrl}`;

    try {
        if ((isMovie || isTv) && subjectId && subjectId.length > 2) {
            const movie = await fetchSubjectDetails(subjectId);
            if (movie) {
                const isTvSeries = isTv || movie.subjectType === 2 || movie.type === 'TV Series' || movie.category === 'Series';
                const rawTitle = isTvSeries 
                    ? `${movie.title || movie.name} | Stream TV Series Online Free - SLFLIX`
                    : `${movie.title || movie.name} | Watch Online Free - SLFLIX`;
                const movieOwnDesc = (movie.description || movie.introduction || movie.summary || '').trim();
                const rawDescription = movieOwnDesc || `Watch ${movie.title || movie.name} online free in HD. ${movie.genre || movie.category || 'Stream now on SLFLIX'}.`;
                const title = rawTitle.replace(/"/g, '&quot;');
                const description = rawDescription.replace(/"/g, '&quot;').replace(/[\r\n]+/g, ' ');
                const image = `${hostUrl}/api/og/${isTvSeries ? 'tv' : 'movie'}/${subjectId}.png`;
                const movieCoverUrl = movie.cover?.url || movie.thumbnail || DEFAULT_OG_POSTER;

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
        } else if (isNovel) {
            let novelTitle = 'SLFLIX Novel Hub | Read Romance, Fantasy & Mystery Web Novels';
            let novelDesc = 'Immersive e-reader with auto-scroll, chapter bookmarks, and thousands of top-rated web novels online for free on SLFLIX.';
            let novelCover = `${hostUrl}/icons/slflix.png`;
            let novelId = subjectId;

            if (novelId) {
                try {
                    const nRes = await fetch(`https://api.omegatech.app/api/Novel/novel?action=detail&novelId=${encodeURIComponent(novelId)}`, {
                        signal: AbortSignal.timeout(3000)
                    });
                    if (nRes.ok) {
                        const nData = await nRes.json();
                        const nInfo = nData.data || nData.result || nData.novel;
                        if (nInfo?.title) {
                            novelTitle = `${nInfo.title} | Read Free Online - SLFLIX Novel Hub`;
                            novelDesc = (nInfo.summary || `Read ${nInfo.title} by ${nInfo.author || 'Author'} online free on SLFLIX Novel Hub.`).trim();
                            novelCover = nInfo.cover || novelCover;
                        }
                    }
                } catch (e) {}
            }

            const image = novelId ? `${hostUrl}/api/og/novel/${novelId}.png` : `${hostUrl}/api/og/novels.png`;
            html = injectSeoTags(html, {
                title: novelTitle.replace(/"/g, '&quot;'),
                description: novelDesc.replace(/"/g, '&quot;').replace(/[\r\n]+/g, ' '),
                image,
                icon: novelCover,
                url: fullUrl,
                type: 'book'
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
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 SLFLIX Server running on http://localhost:${PORT}`);
    console.log(`📊 Full production app ready!`);
});
export default app;