import { MovieResult } from '../types';
const SITE_NAME = 'SL-FLIX';
const SITE_URL = 'https://devomega.my.id';
const DEFAULT_IMAGE = '/icons/slflix.png';
const DEFAULT_DESCRIPTION = 'Watch Movies, TV Series & Anime Online Free in HD. Stream latest films and shows without registration.';

export const updateFavicon = (iconUrl: string) => {
    if (typeof document === 'undefined') return;
    const rels = ['icon', 'shortcut icon', 'apple-touch-icon'];
    rels.forEach(rel => {
        let el = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement;
        if (!el) {
            el = document.createElement('link');
            el.setAttribute('rel', rel);
            document.head.appendChild(el);
        }
        el.setAttribute('href', iconUrl);
    });
};

export const updateMetaTags = (movie: MovieResult | null, isHome: boolean = false) => {
    const movieTitle = movie?.title || '';
    const title = movie 
        ? `${movieTitle} | Watch Online Free - ${SITE_NAME}`
        : `${SITE_NAME} | Free Movies, TV Shows & Anime Streaming`;
    
    // Use the movie's own description when on detail page
    const movieOwnDescription = movie?.description?.trim();
    const description = (isHome || !movie) 
        ? DEFAULT_DESCRIPTION 
        : (movieOwnDescription || `Watch ${movieTitle} online free in HD. ${movie.genre || 'Stream now on ' + SITE_NAME}.`);
    
    const hostUrl = `${window.location.protocol}//${window.location.host}`;
    const subjectId = movie?.subjectId || movie?.detailPath || '';
    const image = (movie && subjectId) ? `${hostUrl}/api/og/${subjectId}.png` : `${hostUrl}${DEFAULT_IMAGE}`;
    const url = window.location.href;

    document.title = title;

    // Update head icon (browser tab icon / favicon / apple-touch-icon) to the movie's image
    const anyMovie = movie as any;
    const movieCover = (typeof anyMovie?.cover === 'object' && anyMovie?.cover?.url)
        ? anyMovie.cover.url
        : (typeof anyMovie?.cover === 'string' ? anyMovie.cover : (anyMovie?.thumbnail || anyMovie?.poster || ''));
    const headIcon = (!isHome && movieCover) ? movieCover : DEFAULT_IMAGE;
    updateFavicon(headIcon);

    const setMeta = (property: string, content: string, isName: boolean = false) => {
        let el: HTMLMetaElement | null = isName 
            ? document.querySelector(`meta[name="${property}"]`) as HTMLMetaElement
            : document.querySelector(`meta[property="${property}"]`) as HTMLMetaElement;
        if (!el) {
            el = document.createElement('meta');
            if (!isName) el.setAttribute('property', property);
            else el.setAttribute('name', property);
            document.head.appendChild(el);
        }
        el.setAttribute('content', content);
    };

    setMeta('description', description, true);
    
    const keywords = movie 
        ? `${movieTitle}, watch ${movieTitle} online, stream ${movieTitle}, ${movie.genre || ''}, ${movie.countryName || ''}, free movie streaming, watch online free, hd movies, ${movie.type}, ${movie.releaseDate || ''}`
        : 'free movies, tv shows, anime, streaming, watch online, hd, 4k, movies online, series streaming';
    setMeta('keywords', keywords, true);
    setMeta('robots', 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1', true);
    setMeta('googlebot', 'index, follow, all', true);
    setMeta('googlebot-news', 'index, follow', true);
    setMeta('googlebot-video', 'index, follow', true);

    const isTv = movie?.type === 'TV Series' || anyMovie?.category === 'Series' || anyMovie?.subjectType === 2;
    setMeta('og:type', isHome ? 'website' : (isTv ? 'video.tv_show' : 'video.movie'));
    setMeta('og:title', title);
    setMeta('og:description', description);
    setMeta('og:image', image);
    setMeta('og:image:type', 'image/png');
    setMeta('og:image:width', '1200');
    setMeta('og:image:height', '630');
    setMeta('og:image:alt', movieTitle ? `Watch ${movieTitle} online free` : 'SL-FLIX Movies');
    setMeta('og:url', url);
    setMeta('og:site_name', SITE_NAME);
    setMeta('og:locale', 'en_US');

    if (!isHome && movie) {
        setMeta('video:title', movieTitle);
        setMeta('video:description', description);
        setMeta('video:image', image);
        setMeta('video:duration', '7200');
        setMeta('video:release_date', movie.releaseDate || '');
        setMeta('video:tag', movie.genre || '');
    }

    setMeta('twitter:card', 'summary_large_image', true);
    setMeta('twitter:title', title, true);
    setMeta('twitter:description', description, true);
    setMeta('twitter:image', image, true);
    setMeta('twitter:image:alt', movieTitle ? `Watch ${movieTitle}` : 'SL-FLIX Movies', true);
    setMeta('twitter:site', '@slflix', true);
    setMeta('twitter:creator', '@slflix', true);
    setMeta('author', SITE_NAME, true);
    setMeta('copyright', `© ${new Date().getFullYear()} ${SITE_NAME}`, true);
    setMeta('language', 'english', true);
    setMeta('revisit-after', '1 day', true);

    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
    if (!canonical) {
        canonical = document.createElement('link');
        canonical.setAttribute('rel', 'canonical');
        document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', url);

    updateJsonLd(movie, isHome);
};
const updateJsonLd = (movie: MovieResult | null, isHome: boolean) => {
    const existing = document.getElementById('json-ld-schema');
    if (existing) {
        existing.remove();
    }
    let schema: any;
    if (isHome || !movie) {
        schema = {
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": SITE_NAME,
            "url": SITE_URL,
            "description": DEFAULT_DESCRIPTION,
            "potentialAction": {
                "@type": "SearchAction",
                "target": {
                    "@type": "EntryPoint",
                    "urlTemplate": `${SITE_URL}/search?q={search_term_string}`
                },
                "query-input": "required name=search_term_string"
            },
            "publisher": {
                "@type": "Organization",
                "name": SITE_NAME,
                "logo": {
                    "@type": "ImageObject",
                    "url": DEFAULT_IMAGE
                }
            }
        };
    } else {
        const movieType = movie.type?.toLowerCase().includes('series') || movie.type?.toLowerCase().includes('tv') 
            ? 'TVSeries' 
            : 'Movie';
        schema = {
            "@context": "https://schema.org",
            "@type": movieType,
            "name": movie.title,
            "description": movie.description?.slice(0, 5000) || `Watch ${movie.title} online free`,
            "image": movie.cover || movie.thumbnail,
            "url": window.location.href,
            "datePublished": movie.releaseDate,
            "dateModified": movie.releaseDate,
            "genre": movie.genre,
            "contentRating": "PG-13",
            "author": {
                "@type": "Organization",
                "name": SITE_NAME
            },
            "publisher": {
                "@type": "Organization",
                "name": SITE_NAME,
                "logo": {
                    "@type": "ImageObject",
                    "url": DEFAULT_IMAGE
                }
            },
            "aggregateRating": movie.imdbRating ? {
                "@type": "AggregateRating",
                "ratingValue": movie.imdbRating,
                "bestRating": "10",
                "worstRating": "1",
                "ratingCount": "10000"
            } : undefined,
            "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "USD",
                "availability": "https://schema.org/InStock"
            }
        };
        if (movie.cast && movie.cast.length > 0) {
            (schema as any).actor = movie.cast.slice(0, 10).map(c => ({
                "@type": "Person",
                "name": c.name,
                "character": c.character
            }));
        }
        if (movie.trailerUrl) {
            (schema as any).video = {
                "@type": "VideoObject",
                "name": `${movie.title} - Trailer`,
                "description": movie.description,
                "thumbnailUrl": [movie.thumbnail || movie.cover],
                "uploadDate": movie.releaseDate ? `${movie.releaseDate}T00:00:00+00:00` : undefined,
                "contentUrl": movie.trailerUrl,
                "embedUrl": window.location.href
            };
        }
    }
    const script = document.createElement('script');
    script.id = 'json-ld-schema';
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(schema);
    document.head.appendChild(script);
};
export const getMovieSchema = (movie: MovieResult) => ({
    "@context": "https://schema.org",
    "@type": movie.type?.toLowerCase().includes('series') ? "TVSeries" : "Movie",
    "name": movie.title,
    "description": movie.description?.slice(0, 5000),
    "image": movie.cover || movie.thumbnail,
    "url": window.location.href,
    "datePublished": movie.releaseDate,
    "genre": movie.genre,
    "director": movie.cast?.find(c => c.character?.toLowerCase().includes('director')) ? {
        "@type": "Person",
        "name": movie.cast.find(c => c.character?.toLowerCase().includes('director'))?.name
    } : undefined,
    "actor": movie.cast?.slice(0, 10).map(c => ({
        "@type": "Person",
        "name": c.name,
        "character": c.character
    })),
    "aggregateRating": movie.imdbRating ? {
        "@type": "AggregateRating",
        "ratingValue": movie.imdbRating,
        "bestRating": "10",
        "ratingCount": "10000"
    } : undefined,
    "workPresented": movie.type?.includes('Series') ? {
        "@type": "TVSeries",
        "name": movie.title
    } : undefined
});
export const getVideoSchema = (movie: MovieResult) => ({
    "@context": "https://schema.org",
    "@type": "VideoObject",
    "name": `${movie.title} - Watch Online`,
    "description": movie.description?.slice(0, 5000),
    "thumbnailUrl": [movie.thumbnail || movie.cover],
    "uploadDate": movie.releaseDate ? `${movie.releaseDate}T00:00:00+00:00` : undefined,
    "duration": "PT120M",
    "contentUrl": window.location.href,
    "embedUrl": window.location.href,
    "interactionStatistic": [{
        "@type": "InteractionCounter",
        "interactionType": "https://schema.org/WatchAction",
        "userInteractionCount": "10000"
    }]
});
export const resetToHomeSEO = () => {
    updateMetaTags(null, true);
};
export default updateMetaTags;
export const getCurrentSeoInfo = () => {
    return {
        title: document.title,
        url: window.location.href,
        description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
        image: document.querySelector('meta[property="og:image"]')?.getAttribute('content') || ''
    };
};