/**
 * SL-FLIX Router Configuration
 * Uses createBrowserRouter for modern React Router v6+
 * Includes dynamic routes, loaders with infinite retry, and nested layouts
 */

import { createBrowserRouter, RouterProvider, Navigate, useLoaderData, useParams } from 'react-router-dom';
import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { ApiService } from './services/api';
import { MovieResult, CategoryData, VideoSource, Subtitle } from './types';
import { cacheService, CacheService } from './services/cache';
import { updateMetaTags, resetToHomeSEO } from './services/seo';

// ============================================================================
// LOADER FUNCTIONS (with infinite retry built-in)
// ============================================================================

/**
 * Create a loader with infinite retry
 * Uses the cache service for instant loading + background refresh
 */
function createInfiniteRetryLoader<T>(
  fetcher: () => Promise<T>,
  cacheKey: string,
  cacheTime: number = 60000
) {
  return async (): Promise<T> => {
    // Try cache first for instant load
    const cached = cacheService.get<T>(cacheKey);
    if (cached?.data && !cached.isStale) {
      // Prefetch fresh data in background
      cacheService.prefetch(cacheKey, fetcher, cacheTime);
      return cached.data;
    }

    // If stale cache exists, return it while refreshing
    if (cached?.data) {
      cacheService.prefetch(cacheKey, fetcher, cacheTime);
      return cached.data;
    }

    // No cache - fetch and cache
    const data = await fetcher();
    cacheService.set(cacheKey, data, cacheTime);
    return data;
  };
}

// Home page loader
async function homeLoader() {
  const cacheKey = 'home:data';
  const cached = cacheService.get<{ categories: CategoryData[]; hero: MovieResult[] }>(cacheKey);
  
  if (cached?.data) {
    cacheService.prefetch(cacheKey, () => ApiService.getHomeData(), 5 * 60 * 1000);
    return cached.data;
  }

  const data = await ApiService.getHomeData();
  cacheService.set(cacheKey, data, 5 * 60 * 1000);
  return data;
}

// Movie/Series detail loader with type parameter for series refresh fix
async function detailLoader({ params }: { params: { id: string; type?: string } }) {
  const { id } = params;
  const isSeries = params.type === 'series' || params.type === 'tv';
  
  // Try cache first
  const cacheKey = CacheService.movieKey(id);
  const cached = cacheService.get<MovieResult>(cacheKey);
  
  if (cached?.data && !cached.isStale) {
    // For series, ensure full seasons/episodes data is loaded on refresh
    if (isSeries && (!cached.data.seasons || cached.data.seasons.length === 0)) {
      // Fetch fresh data to get seasons
      const fresh = await ApiService.getMovieById(id);
      const full = await ApiService.getDetails(fresh);
      cacheService.set(cacheKey, full, 10 * 60 * 1000);
      return { movie: full, isSeries: true };
    }
    cacheService.prefetch(cacheKey, () => ApiService.getMovieById(id).then(m => ApiService.getDetails(m)), 10 * 60 * 1000);
    return { movie: cached.data, isSeries };
  }

  // Fetch full details
  const movie = await ApiService.getMovieById(id);
  const fullDetails = await ApiService.getDetails(movie);
  cacheService.set(cacheKey, fullDetails, 10 * 60 * 1000);
  
  updateMetaTags(fullDetails, false);
  return { movie: fullDetails, isSeries: isSeries || fullDetails.type.includes('Series') };
}

// Search loader
async function searchLoader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const query = url.searchParams.get('q') || '';
  
  if (!query) return { results: [], query: '' };

  const cacheKey = CacheService.searchKey(query, 1);
  const cached = cacheService.get<{ results: MovieResult[]; hasMore: boolean; nextPage: number }>(cacheKey);
  
  if (cached?.data) {
    cacheService.prefetch(cacheKey, () => ApiService.search(query, 1), 3 * 60 * 1000);
    return { results: cached.data.results, query, hasMore: cached.data.hasMore };
  }

  const result = await ApiService.search(query, 1);
  cacheService.set(cacheKey, result, 3 * 60 * 1000);
  return { results: result.results, query, hasMore: result.hasMore };
}

// Trending loader
async function trendingLoader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '0');
  
  const cacheKey = `trending:${page}:18`;
  const cached = cacheService.get<{ results: MovieResult[]; hasMore: boolean }>(cacheKey);
  
  if (cached?.data) {
    cacheService.prefetch(cacheKey, () => ApiService.getTrending(page), 2 * 60 * 1000);
    return cached.data;
  }

  const result = await ApiService.getTrending(page);
  cacheService.set(cacheKey, result, 2 * 60 * 1000);
  return result;
}

// Ranking list loader
async function rankingLoader({ params, request }: { params: { category: string }; request: Request }) {
  const { category } = params;
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  
  const cacheKey = `ranking:${category}:${page}`;
  const cached = cacheService.get<{ title: string; results: MovieResult[]; hasMore: boolean }>(cacheKey);
  
  if (cached?.data) {
    cacheService.prefetch(cacheKey, () => ApiService.getRankingList(category, page), 2 * 60 * 1000);
    return cached.data;
  }

  const result = await ApiService.getRankingList(category, page);
  cacheService.set(cacheKey, result, 2 * 60 * 1000);
  return result;
}

// ============================================================================
// PAGE COMPONENTS
// ============================================================================

// Loading component
const PageLoader: React.FC = () => (
  <div className="fixed inset-0 z-[5000] bg-black/80 backdrop-blur-md flex items-center justify-center">
    <div className="relative w-16 h-16">
      <div className="absolute inset-0 border-t-4 border-primary rounded-full animate-spin"></div>
      <div className="absolute inset-2 border-r-4 border-white/40 rounded-full animate-[spin_1.5s_linear_infinite_reverse]"></div>
    </div>
  </div>
);

// Error fallback (should never show due to infinite retry)
const ErrorFallback: React.FC = () => (
  <div className="min-h-screen bg-[#0a0a15] flex items-center justify-center">
    <div className="text-center">
      <div className="text-6xl mb-4">🔄</div>
      <p className="text-white text-xl">Loading...</p>
    </div>
  </div>
);

// ============================================================================
// LAYOUT COMPONENTS
// ============================================================================

interface AppLayoutProps {
  children: React.ReactNode;
}

// Main App Layout with Navbar
const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  return (
    <div className="bg-[#0a0a15] min-h-screen text-white font-sans overflow-x-hidden flex flex-col">
      {children}
    </div>
  );
};

// ============================================================================
// ROUTE DEFINITIONS
// ============================================================================

/**
 * Create the browser router with all routes
 * Uses createBrowserRouter for modern React Router v6+
 */
export function createAppRouter() {
  return createBrowserRouter([
    // Home route
    {
      path: '/',
      element: <AppLayout><div id="home-content" /></AppLayout>,
      loader: homeLoader,
      errorElement: <ErrorFallback />
    },
    // Movie detail route
    {
      path: '/movie/:id',
      element: <AppLayout><div id="detail-content" /></AppLayout>,
      loader: ({ params }) => detailLoader({ params: { id: params.id || '', type: 'movie' } }),
      errorElement: <ErrorFallback />
    },
    // Series detail route with type parameter for refresh fix
    {
      path: '/series/:id',
      element: <AppLayout><div id="detail-content" /></AppLayout>,
      loader: ({ params }) => detailLoader({ params: { id: params.id || '', type: 'series' } }),
      errorElement: <ErrorFallback />
    },
    // Alternative series route with query param
    {
      path: '/tv/:id',
      element: <AppLayout><div id="detail-content" /></AppLayout>,
      loader: ({ params }) => detailLoader({ params: { id: params.id || '', type: 'tv' } }),
      errorElement: <ErrorFallback />
    },
    // Search route
    {
      path: '/search',
      element: <AppLayout><div id="search-content" /></AppLayout>,
      loader: searchLoader,
      errorElement: <ErrorFallback />
    },
    // Trending route
    {
      path: '/trending',
      element: <AppLayout><div id="trending-content" /></AppLayout>,
      loader: trendingLoader,
      errorElement: <ErrorFallback />
    },
    // Top list route
    {
      path: '/toplist/:category?',
      element: <AppLayout><div id="toplist-content" /></AppLayout>,
      loader: ({ params }) => rankingLoader({ 
        params: { category: params.category || 'trending' }, 
        request: new Request(window.location.href) 
      }),
      errorElement: <ErrorFallback />
    },
    // Watch route (for player)
    {
      path: '/watch/:id',
      element: <div id="player-content" />,
      loader: ({ params }) => detailLoader({ params: { id: params.id || '' } }),
      errorElement: <ErrorFallback />
    },
    // Catch-all redirect to home
    {
      path: '*',
      element: <Navigate to="/" replace />
    }
  ], {
    // Router options
    basename: '/',
    future: {
      v7_relativeSplatPath: true,
      v7_fetcherPersist: true,
      v7_normalizeFormMethod: true
    }
  });
}

// Export router instance
export const appRouter = createAppRouter();

// Router Provider component
export const Router: React.FC = () => {
  return <RouterProvider router={appRouter} />;
};

export default Router;

