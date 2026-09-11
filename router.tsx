import { createBrowserRouter, RouterProvider, Navigate, useLoaderData, useParams, useRouteError, isRouteErrorResponse } from 'react-router-dom';
import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { ApiService } from './services/api';
import { MovieResult, CategoryData, VideoSource, Subtitle } from './types';
import { cacheService, CacheService } from './services/cache';
import { updateMetaTags, resetToHomeSEO } from './services/seo';
function createInfiniteRetryLoader<T>(
  fetcher: () => Promise<T>,
  cacheKey: string,
  cacheTime: number = 60000
) {
  return async (): Promise<T> => {
    const cached = cacheService.get<T>(cacheKey);
    if (cached?.data && !cached.isStale) {
      cacheService.prefetch(cacheKey, fetcher, cacheTime);
      return cached.data;
    }
    if (cached?.data) {
      cacheService.prefetch(cacheKey, fetcher, cacheTime);
      return cached.data;
    }
    const data = await fetcher();
    cacheService.set(cacheKey, data, cacheTime);
    return data;
  };
}
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
async function detailLoader({ params }: { params: { id: string; type?: string } }) {
  const { id } = params;
  const isSeries = params.type === 'series' || params.type === 'tv';
  const cacheKey = CacheService.movieKey(id);
  const cached = cacheService.get<MovieResult>(cacheKey);
  if (cached?.data && !cached.isStale) {
    if (isSeries && (!cached.data.seasons || cached.data.seasons.length === 0)) {
      const fresh = await ApiService.getMovieById(id);
      const full = await ApiService.getDetails(fresh);
      cacheService.set(cacheKey, full, 10 * 60 * 1000);
      return { movie: full, isSeries: true };
    }
    cacheService.prefetch(cacheKey, () => ApiService.getMovieById(id).then(m => ApiService.getDetails(m)), 10 * 60 * 1000);
    return { movie: cached.data, isSeries };
  }
  const movie = await ApiService.getMovieById(id);
  const fullDetails = await ApiService.getDetails(movie);
  cacheService.set(cacheKey, fullDetails, 10 * 60 * 1000);
  updateMetaTags(fullDetails, false);
  return { movie: fullDetails, isSeries: isSeries || fullDetails.type.includes('Series') };
}
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
import { RetroTvError } from './components/RetroTvError';
import { NotFound } from './components/NotFound';

const PageLoader: React.FC = () => (
  <div className="fixed inset-0 z-[5000] bg-black/80 backdrop-blur-md flex items-center justify-center">
    <div className="relative w-16 h-16">
      <div className="absolute inset-0 border-t-4 border-primary rounded-full animate-spin"></div>
      <div className="absolute inset-2 border-r-4 border-white/40 rounded-full animate-[spin_1.5s_linear_infinite_reverse]"></div>
    </div>
  </div>
);

const ErrorFallback: React.FC = () => {
  const error = useRouteError();
  
  // If it's a 404 from the router loader
  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFound />;
  }

  return (
    <div className="min-h-screen bg-[#0a0a15] flex items-center justify-center overflow-hidden">
      <RetroTvError errorCode="ERR" errorMessage="API FAULT" />
    </div>
  );
};
interface AppLayoutProps {
  children: React.ReactNode;
}
const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  return (
    <div className="bg-[#0a0a15] min-h-screen text-white font-sans overflow-x-hidden flex flex-col">
      {children}
    </div>
  );
};
export function createAppRouter() {
  return createBrowserRouter([
    {
      path: '/',
      element: <AppLayout><div id="home-content" /></AppLayout>,
      loader: homeLoader,
      errorElement: <ErrorFallback />
    },
    {
      path: '/movie/:id',
      element: <AppLayout><div id="detail-content" /></AppLayout>,
      loader: ({ params }) => detailLoader({ params: { id: params.id || '', type: 'movie' } }),
      errorElement: <ErrorFallback />
    },
    {
      path: '/series/:id',
      element: <AppLayout><div id="detail-content" /></AppLayout>,
      loader: ({ params }) => detailLoader({ params: { id: params.id || '', type: 'series' } }),
      errorElement: <ErrorFallback />
    },
    {
      path: '/tv/:id',
      element: <AppLayout><div id="detail-content" /></AppLayout>,
      loader: ({ params }) => detailLoader({ params: { id: params.id || '', type: 'tv' } }),
      errorElement: <ErrorFallback />
    },
    {
      path: '/search',
      element: <AppLayout><div id="search-content" /></AppLayout>,
      loader: searchLoader,
      errorElement: <ErrorFallback />
    },
    {
      path: '/trending',
      element: <AppLayout><div id="trending-content" /></AppLayout>,
      loader: trendingLoader,
      errorElement: <ErrorFallback />
    },
    {
      path: '/toplist/:category?',
      element: <AppLayout><div id="toplist-content" /></AppLayout>,
      loader: ({ params }) => rankingLoader({ 
        params: { category: params.category || 'trending' }, 
        request: new Request(window.location.href) 
      }),
      errorElement: <ErrorFallback />
    },
    {
      path: '/watch/:id',
      element: <div id="player-content" />,
      loader: ({ params }) => detailLoader({ params: { id: params.id || '' } }),
      errorElement: <ErrorFallback />
    },
    {
      path: '*',
      element: <NotFound />
    }
  ], {
    basename: '/',
    future: {
      v7_relativeSplatPath: true,
      v7_fetcherPersist: true,
      v7_normalizeFormMethod: true
    }
  });
}
export const appRouter = createAppRouter();
export const Router: React.FC = () => {
  return <RouterProvider router={appRouter} />;
};
export default Router;