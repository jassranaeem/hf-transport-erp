import Redis from "ioredis";

class RedisManager {
  private client: Redis | null = null;
  private isFallback = false;
  private fallbackStore = new Map<string, { value: string; expiry: number | null }>();

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      console.log("[Cache Service] REDIS_URL environment variable is not defined. Using highly optimized in-memory cache fallback.");
      this.isFallback = true;
      return;
    }
    
    // We attempt connection but fail gracefully to in-memory fallback
    try {
      this.client = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        connectTimeout: 2000,
        reconnectOnError: () => false,
        retryStrategy: (times) => {
          // Stop attempting reconnection after first failed try to avoid constant logs/crashes
          if (times === 1) {
            console.warn("[Cache Service] Redis connection failed, switching off reconnection attempts.");
          }
          this.isFallback = true;
          return null;
        }
      });

      this.client.on("error", (err) => {
        if (!this.isFallback) {
          console.warn("[Cache Service] Redis connection failed, falling back to in-memory store:", err.message);
          this.isFallback = true;
        }
      });

      this.client.connect().then(() => {
        console.log("[Cache Service] Redis client connected successfully");
        this.isFallback = false;
      }).catch((err) => {
        console.warn("[Cache Service] Redis connect promise failed, running in-memory fallback:", err.message);
        this.isFallback = true;
      });

    } catch (err: any) {
      console.warn("[Cache Service] Redis initialization failed, using in-memory store:", err.message);
      this.isFallback = true;
    }
  }

  public async get<T>(key: string): Promise<T | null> {
    if (this.isFallback || !this.client) {
      const entry = this.fallbackStore.get(key);
      if (!entry) return null;
      if (entry.expiry && entry.expiry < Date.now()) {
        this.fallbackStore.delete(key);
        return null;
      }
      return JSON.parse(entry.value) as T;
    }

    try {
      const val = await this.client.get(key);
      return val ? (JSON.parse(val) as T) : null;
    } catch (err) {
      return null;
    }
  }

  public async set(key: string, value: any, ttlSec?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    
    if (this.isFallback || !this.client) {
      const expiry = ttlSec ? Date.now() + ttlSec * 1000 : null;
      this.fallbackStore.set(key, { value: serialized, expiry });
      return;
    }

    try {
      if (ttlSec) {
        await this.client.set(key, serialized, "EX", ttlSec);
      } else {
        await this.client.set(key, serialized);
      }
    } catch (err) {
      // Handle cache write failures silently or fallback
      const expiry = ttlSec ? Date.now() + ttlSec * 1000 : null;
      this.fallbackStore.set(key, { value: serialized, expiry });
    }
  }

  public async del(key: string): Promise<void> {
    if (this.isFallback || !this.client) {
      this.fallbackStore.delete(key);
      return;
    }
    try {
      await this.client.del(key);
    } catch (err) {
      this.fallbackStore.delete(key);
    }
  }

  public async keys(pattern: string): Promise<string[]> {
    if (this.isFallback || !this.client) {
      const now = Date.now();
      const results: string[] = [];
      const regexPattern = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
      
      for (const [key, entry] of this.fallbackStore.entries()) {
        if (entry.expiry && entry.expiry < now) {
          this.fallbackStore.delete(key);
          continue;
        }
        if (regexPattern.test(key)) {
          results.push(key);
        }
      }
      return results;
    }

    try {
      return await this.client.keys(pattern);
    } catch (err) {
      return [];
    }
  }

  public async flush(): Promise<void> {
    if (this.isFallback || !this.client) {
      this.fallbackStore.clear();
      return;
    }
    try {
      await this.client.flushall();
    } catch (err) {
      this.fallbackStore.clear();
    }
  }

  public getStatus(): string {
    return this.isFallback ? "FALLBACK_IN_MEMORY" : "REDIS_CONNECTED";
  }
}

export const cacheService = new RedisManager();
