/**
 * SL-FLIX Multi-Layer Caching Service
 * Provides client-side caching with timestamp validation
 * and background refresh capabilities
 */

import { safeConsole } from '../utils/productionGuard';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

interface CachedData<T> {
  data: T;
  isStale: boolean;
  lastUpdated: number;
}

// Cache configuration
const CACHE_CONFIG = {
  // Cache durations in milliseconds
  home: 5 * 60 * 1000,        // 5 minutes for home data
  details: 10 * 60 * 1000,    // 10 minutes for movie details
  sources: 2 * 60 * 1000,     // 2 minutes for streaming sources
  search: 3 * 60 * 1000,      // 3 minutes for search results
  seasons: 15 * 60 * 1000,    // 15 minutes for season/episode data
  trending: 2 * 60 * 1000,    // 2 minutes for trending
  
  // Stale threshold - when to show stale data while refreshing
  STALE_THRESHOLD: 0.7,       // Refresh when 70% of cache time has passed
};

class CacheService {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private refreshPromises: Map<string, Promise<any>> = new Map();

  /**
   * Get data from cache with automatic background refresh
   */
  async getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    cacheTime: number = CACHE_CONFIG.home
  ): Promise<CachedData<T>> {
    const entry = this.cache.get(key);
    const now = Date.now();
    
    // Cache miss - fetch immediately
    if (!entry) {
      try {
        const data = await fetcher();
        this.set(key, data, cacheTime);
        return { data, isStale: false, lastUpdated: now };
      } catch (error) {
        safeConsole.error(`[Cache] Failed to fetch ${key}:`, error);
        throw error;
      }
    }
    
    const age = now - entry.timestamp;
    const isStale = age > cacheTime * CACHE_CONFIG.STALE_THRESHOLD;
    
    // Cache is fresh - return immediately
    if (!isStale && entry.data) {
      return {
        data: entry.data,
        isStale: false,
        lastUpdated: entry.timestamp
      };
    }
    
    // Cache is stale but exists - refresh in background
    if (isStale && entry.data) {
      this.refreshInBackground(key, fetcher, cacheTime);
      return {
        data: entry.data,
        isStale: true,
        lastUpdated: entry.timestamp
      };
    }
    
    // Return existing data if available
    return {
      data: entry?.data,
      isStale: true,
      lastUpdated: entry?.timestamp || now
    };
  }

  /**
   * Refresh data in background without blocking
   */
  private refreshInBackground<T>(
    key: string,
    fetcher: () => Promise<T>,
    cacheTime: number
  ): void {
    // Prevent duplicate refresh requests
    if (this.refreshPromises.has(key)) {
      return;
    }

    const promise = fetcher()
      .then(data => {
        this.set(key, data, cacheTime);
        this.refreshPromises.delete(key);
        return data;
      })
      .catch(error => {
        safeConsole.warn(`[Cache] Background refresh failed for ${key}:`, error);
        this.refreshPromises.delete(key);
        throw error;
      });

    this.refreshPromises.set(key, promise);
  }

  /**
   * Set data in cache
   */
  set<T>(key: string, data: T, cacheTime: number = CACHE_CONFIG.home): void {
    const now = Date.now();
    this.cache.set(key, {
      data,
      timestamp: now,
      expiresAt: now + cacheTime
    });
  }

  /**
   * Get data from cache without fetching
   */
  get<T>(key: string): CachedData<T> | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    const now = Date.now();
    const isStale = now > entry.expiresAt;
    
    return {
      data: entry.data,
      isStale,
      lastUpdated: entry.timestamp
    };
  }

  /**
   * Check if key exists in cache
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Remove specific cache entry
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
    this.refreshPromises.clear();
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Clean up expired entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Prefetch data for likely next actions
   */
  prefetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    cacheTime: number = CACHE_CONFIG.home
  ): void {
    // Only prefetch if not already cached or refreshing
    if (!this.cache.has(key) && !this.refreshPromises.has(key)) {
      this.refreshInBackground(key, fetcher, cacheTime);
    }
  }

  /**
   * Generate cache key for movie details
   */
  static movieKey(subjectId: string, detailPath?: string): string {
    return `movie:${subjectId}:${detailPath || 'default'}`;
  }

  /**
   * Generate cache key for seasons
   */
  static seasonsKey(subjectId: string): string {
    return `seasons:${subjectId}`;
  }

  /**
   * Generate cache key for sources
   */
  static sourcesKey(subjectId: string, season?: number, episode?: number): string {
    return `sources:${subjectId}:${season || 0}:${episode || 0}`;
  }

  /**
   * Generate cache key for search
   */
  static searchKey(query: string, page: number): string {
    return `search:${query.toLowerCase().trim()}:${page}`;
  }
}

// Export singleton instance and class
export const cacheService = new CacheService();
export { CacheService };
export default cacheService;

