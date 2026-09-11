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
const CACHE_CONFIG = {
  home: 5 * 60 * 1000,        
  details: 10 * 60 * 1000,    
  sources: 2 * 60 * 1000,     
  search: 3 * 60 * 1000,      
  seasons: 15 * 60 * 1000,    
  trending: 2 * 60 * 1000,    
  STALE_THRESHOLD: 0.7,       
};
class CacheService {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private refreshPromises: Map<string, Promise<any>> = new Map();
  async getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    cacheTime: number = CACHE_CONFIG.home
  ): Promise<CachedData<T>> {
    const entry = this.cache.get(key);
    const now = Date.now();
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
    if (!isStale && entry.data) {
      return {
        data: entry.data,
        isStale: false,
        lastUpdated: entry.timestamp
      };
    }
    if (isStale && entry.data) {
      this.refreshInBackground(key, fetcher, cacheTime);
      return {
        data: entry.data,
        isStale: true,
        lastUpdated: entry.timestamp
      };
    }
    return {
      data: entry?.data,
      isStale: true,
      lastUpdated: entry?.timestamp || now
    };
  }
  private refreshInBackground<T>(
    key: string,
    fetcher: () => Promise<T>,
    cacheTime: number
  ): void {
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
  set<T>(key: string, data: T, cacheTime: number = CACHE_CONFIG.home): void {
    const now = Date.now();
    this.cache.set(key, {
      data,
      timestamp: now,
      expiresAt: now + cacheTime
    });
  }
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
  has(key: string): boolean {
    return this.cache.has(key);
  }
  delete(key: string): void {
    this.cache.delete(key);
  }
  clear(): void {
    this.cache.clear();
    this.refreshPromises.clear();
  }
  size(): number {
    return this.cache.size;
  }
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
  prefetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    cacheTime: number = CACHE_CONFIG.home
  ): void {
    if (!this.cache.has(key) && !this.refreshPromises.has(key)) {
      this.refreshInBackground(key, fetcher, cacheTime);
    }
  }
  static movieKey(subjectId: string, detailPath?: string): string {
    return `movie:${subjectId}:${detailPath || 'default'}`;
  }
  static seasonsKey(subjectId: string): string {
    return `seasons:${subjectId}`;
  }
  static sourcesKey(subjectId: string, season?: number, episode?: number): string {
    return `sources:${subjectId}:${season || 0}:${episode || 0}`;
  }
  static searchKey(query: string, page: number): string {
    return `search:${query.toLowerCase().trim()}:${page}`;
  }
}
export const cacheService = new CacheService();
export { CacheService };
export default cacheService;