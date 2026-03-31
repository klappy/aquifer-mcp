import type { Env } from "./types.js";

/**
 * App version embedded in Cache API keys.
 * New deploy = cache miss = fresh R2 read = no stale data.
 */
const APP_VERSION = "1.2.0";

/** Cap memory cache to avoid OOM during large traversals (e.g. entity bootstrap). */
const MAX_MEMORY_ENTRIES = 50;

/**
 * Three-tier storage: Memory → Cache API → R2.
 *
 * Modeled on translation-helps-mcp's R2Storage pattern.
 * Keys encode full provenance (type/resource/sha/language/file).
 * No TTL anywhere — content-addressed by SHA. Cleanup is hygiene, never correctness.
 */
export class AquiferStorage {
  private memoryCache: Map<string, string> = new Map();

  constructor(
    private env: Env,
    private cacheStorage?: CacheStorage,
  ) {}

  private get cache(): Cache | null {
    try {
      return (
        this.cacheStorage?.default ??
        (globalThis as unknown as { caches?: CacheStorage }).caches?.default ??
        null
      );
    } catch {
      return null;
    }
  }

  /** Versioned cache key — new deploy = cache miss = fresh R2 read */
  private cacheRequest(key: string): Request {
    return new Request(`https://aquifer-r2.local/v${APP_VERSION}/${key}`);
  }

  /**
   * Get JSON from three-tier cache.
   * Memory → Cache API → R2 → null.
   */
  async getJSON<T>(key: string): Promise<{ data: T | null; source: "memory" | "cache" | "r2" | "miss" }> {
    // Tier 1: Memory
    const mem = this.memoryCache.get(key);
    if (mem) return { data: JSON.parse(mem) as T, source: "memory" };

    // Tier 2: Cache API
    const c = this.cache;
    if (c) {
      const hit = await c.match(this.cacheRequest(key));
      if (hit) {
        const text = await hit.text();
        if (this.memoryCache.size < MAX_MEMORY_ENTRIES) {
          this.memoryCache.set(key, text);
        }
        return { data: JSON.parse(text) as T, source: "cache" };
      }
    }

    // Tier 3: R2
    if (!this.env.AQUIFER_CONTENT) return { data: null, source: "miss" };
    const obj = await this.env.AQUIFER_CONTENT.get(key);
    if (!obj) return { data: null, source: "miss" };

    const text = await obj.text();
    if (this.memoryCache.size < MAX_MEMORY_ENTRIES) {
      this.memoryCache.set(key, text);
    }

    // Populate Cache API for next request
    if (c) {
      try {
        await c.put(
          this.cacheRequest(key),
          new Response(text, {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=604800",
            },
          }),
        );
      } catch { /* cache promotion is best-effort */ }
    }

    return { data: JSON.parse(text) as T, source: "r2" };
  }

  /**
   * Store JSON in R2 + Cache API. Memory is populated on read.
   * Returns true if write succeeded, false if it failed.
   */
  async putJSON(key: string, data: unknown): Promise<boolean> {
    const text = JSON.stringify(data);

    // Write to R2
    if (!this.env.AQUIFER_CONTENT) return false;
    try {
      await this.env.AQUIFER_CONTENT.put(key, text, {
        httpMetadata: {
          contentType: "application/json",
          cacheControl: "public, max-age=604800",
        },
      });
    } catch {
      return false;
    }

    // Populate Cache API
    const c = this.cache;
    if (c) {
      try {
        await c.put(
          this.cacheRequest(key),
          new Response(text, {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=604800",
            },
          }),
        );
      } catch { /* cache population is best-effort; R2 write already succeeded */ }
    }

    return true;
  }
}

// --- Key builders: provenance-encoding key patterns ---

export function indexKey(compositeSha: string): string {
  return `index/${compositeSha}/navigability.json`;
}

export function contentKey(resourceCode: string, sha: string, language: string, file: string): string {
  return `content/${resourceCode}/${sha}/${language}/${file}`;
}

export function metadataKey(resourceCode: string, sha: string, language: string): string {
  return `metadata/${resourceCode}/${sha}/${language}/metadata.json`;
}

export function catalogKey(resourceCode: string, sha: string, language: string): string {
  return `catalog/${resourceCode}/${sha}/${language}/browse.json`;
}

export function entityKey(compositeSha: string, entityId: string): string {
  return `entity/${compositeSha}/${entityId}.json`;
}

export function passageIndexKey(resourceCode: string, sha: string): string {
  return `index/${resourceCode}/${sha}/passages.json`;
}

export function titleIndexKey(resourceCode: string, sha: string): string {
  return `index/${resourceCode}/${sha}/titles.json`;
}
