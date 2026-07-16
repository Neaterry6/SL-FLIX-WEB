/**
 * SEO Service for SL-FLIX
 * Handles dynamic meta tags, Open Graph, Twitter Cards, and JSON-LD structured data
 * Optimized for Google indexing and social media sharing
 */

import { MovieResult } from '../types';

const SITE_NAME = 'SL-FLIX';
const SITE_URL = 'https://sl-flix.dixonomega.tech';
const DEFAULT_IMAGE = 'https://files.catbox.moe/lhdbe0.png';
const DEFAULT_DESCRIPTION = 'Watch Movies, TV Series & Anime Online Free in HD. Stream latest films and shows without registration.';

/**
 * Update document meta tags for SEO - optimized for Google movie indexing
 */
export const updateMetaTags = (movie: MovieResult | null, isHome: boolean = false) => {
    // Get movie data or use defaults
    const movieTitle = movie?.title || '';
    
    // Title format: "Movie Name | SL-FLIX" for better SEO - shows movie name first
    const title = movie 
        ? `${movieTitle} | Watch Online Free - ${SITE_NAME}`
        : `${SITE_NAME} | Free Movies, TV Shows & Anime Streaming`;
    
    // Description with movie name for better Google indexing
    const description = movie 
        ? `Watch ${movieTitle} online free in HD. ${movie.description?.slice(0, 100) || movie.genre || 'Stream now on ' + SITE_NAME}. ${movie.releaseDate ? 'Released ' + movie.releaseDate + '.' : ''}`
        : DEFAULT_DESCRIPTION;
    
    // Use movie cover image for social sharing - this shows movie image when link is shared
    const image = movie?.cover || movie?.thumbnail || DEFAULT_IMAGE;
    const url = window.location.href;
    
    // Update document title
    document.title = title;
    
    // Helper to set or update meta tag
    const setMeta = (property: string, content: string, isName: boolean = false) => {
        let el: HTMLMetaElement | null = isName 
            ? document.querySelector(`meta[name="${property}"]`) as HTMLMetaElement
            : document.querySelector(`meta[property="${property}"]`) as HTMLMetaElement;
        
        if (!el) {
            el = document.createElement(isName ? 'meta' : 'meta');
            if (!isName) el.setAttribute('property', property);
            else el.setAttribute('name', property);
            document.head.appendChild(el);
        }
        el.setAttribute('content', content);
    };
    
    // Standard Meta Tags - optimized for Google
    setMeta('description', description, true);
    
    // Keywords - include movie name for better Google indexing
    const keywords = movie 
        ? `${movieTitle}, watch ${movieTitle} online, stream ${movieTitle}, ${movie.genre || ''}, ${movie.countryName || ''}, free movie streaming, watch online free, hd movies, ${movie.type}, ${movie.releaseDate || ''}`
        : 'free movies, tv shows, anime, streaming, watch online, hd, 4k, movies online, series streaming';
    setMeta('keywords', keywords, true);
    
    // Robots directive for Google - allow full indexing
    setMeta('robots', 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1', true);
    
    // Googlebot directives
    setMeta('googlebot', 'index, follow, all', true);
    setMeta('googlebot-news', 'index, follow', true);
    setMeta('googlebot-video', 'index, follow', true);
    
    // Open Graph / Facebook - Movie specific with movie image
    setMeta('og:type', isHome ? 'website' : 'video.movie');
    setMeta('og:title', title);
    setMeta('og:description', description);
    setMeta('og:image', image);
    setMeta('og:image:width', '1280');
    setMeta('og:image:height', '720');
    setMeta('og:image:alt', movieTitle ? `Watch ${movieTitle} online free` : 'SL-FLIX Movies');
    setMeta('og:url', url);
    setMeta('og:site_name', SITE_NAME);
    setMeta('og:locale', 'en_US');
    
    // Video specific OG tags for movie pages
    if (!isHome && movie) {
        setMeta('video:title', movieTitle);
        setMeta('video:description', description);
        setMeta('video:image', image);
        setMeta('video:duration', '7200');
        setMeta('video:release_date', movie.releaseDate || '');
        setMeta('video:tag', movie.genre || '');
    }
    
    // Twitter Card - optimized with movie image
    setMeta('twitter:card', 'summary_large_image');
    setMeta('twitter:title', title);
    setMeta('twitter:description', description);
    setMeta('twitter:image', image);
    setMeta('twitter:image:alt', movieTitle ? `Watch ${movieTitle}` : 'SL-FLIX Movies');
    setMeta('twitter:site', '@slflix');
    setMeta('twitter:creator', '@slflix');
    
    // Additional SEO meta tags
    setMeta('author', SITE_NAME, true);
    setMeta('copyright', `© ${new Date().getFullYear()} ${SITE_NAME}`, true);
    setMeta('language', 'english', true);
    setMeta('revisit-after', '1 day', true);
    
    // Canonical URL
    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
    if (!canonical) {
        canonical = document.createElement('link');
        canonical.setAttribute('rel', 'canonical');
        document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', url);
    
    // Update JSON-LD structured data for Google rich snippets
    updateJsonLd(movie, isHome);
};

/**
 * Update JSON-LD structured data for Google rich snippets
 */
const updateJsonLd = (movie: MovieResult | null, isHome: boolean) => {
    // Remove existing schema
    const existing = document.getElementById('json-ld-schema');
    if (existing) {
        existing.remove();
    }
    
    let schema: any;
    
    if (isHome || !movie) {
        // Website schema for home page
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
        // Movie schema for detail pages - optimized for Google
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
        
        // Add cast if available
        if (movie.cast && movie.cast.length > 0) {
            (schema as any).actor = movie.cast.slice(0, 10).map(c => ({
                "@type": "Person",
                "name": c.name,
                "character": c.character
            }));
        }
        
        // Add trailer if available
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
    
    // Add the schema script
    const script = document.createElement('script');
    script.id = 'json-ld-schema';
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(schema);
    document.head.appendChild(script);
};

/**
 * Generate Movie schema for Google rich snippets
 */
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

/**
 * Generate VideoObject schema for video pages
 */
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

/**
 * Reset SEO to home page defaults
 */
export const resetToHomeSEO = () => {
    updateMetaTags(null, true);
};

export default updateMetaTags;

/**
 * Get current page SEO info
 */
export const getCurrentSeoInfo = () => {
    return {
        title: document.title,
        url: window.location.href,
        description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
        image: document.querySelector('meta[property="og:image"]')?.getAttribute('content') || ''
    };
};
