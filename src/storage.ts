import type { Env } from "./types.js";
import type { RequestTracer } from "./tracing.js";
import { shortKey } from "./tracing.js";
import { VERSION } from "./version.js";

/** Cap module-level memory cache to avoid OOM during large traversals. */
const MAX_MEMORY_ENTRIES = 200;

/** Memory cache TTL — entries older than this are evicted on next access. */
const MEMORY_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Module-level memory cache — survives across requests within the same isolate.
 * This is the key optimization: per-resource indexes loaded during fan-out
 * (30+ subrequests) are cached here and reused on subsequent requests,
 * eliminating subrequests entirely on warm calls.
 *
 * Content-addressed keys (containing SHA) mean stale entries are never read —
 * a new SHA produces a new key. TTL is a memory hygiene measure, not correctness.
 */
const moduleMemoryCache = new Map<string, { value: string; cachedAt: number }>();

/**
 * Three-tier storage: Memory → Cache API → R2.
 *
 * Modeled on translation-helps-mcp's R2Storage pattern.
 * Keys encode full provenance (type/resource/sha/language/file).
 * No TTL anywhere — content-addressed by SHA. Cleanup is hygiene, never correctness.
 */
export class AquiferStorage {

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
    return new Request(`https://aquifer-r2.local/v${VERSION}/${key}`);
  }

  /**
   * Get JSON from three-tier cache.
   * Memory → Cache API → R2 → null.
   */
  async getJSON<T>(key: string, tracer?: RequestTracer): Promise<{ data: T | null; source: "memory" | "cache" | "r2" | "miss" }> {
    const start = performance.now();
    const sk = shortKey(key);

    // Tier 1: Module-level memory cache
    const mem = moduleMemoryCache.get(key);
    if (mem && Date.now() - mem.cachedAt < MEMORY_TTL_MS) {
      tracer?.addSpan(`storage:${sk}`, Math.round(performance.now() - start), "memory");
      return { data: JSON.parse(mem.value) as T, source: "memory" };
    }
    if (mem) {
      moduleMemoryCache.delete(key); // TTL expired — evict
    }

    // Tier 2: Cache API
    const c = this.cache;
    if (c) {
      const hit = await c.match(this.cacheRequest(key));
      if (hit) {
        const text = await hit.text();
        if (moduleMemoryCache.size < MAX_MEMORY_ENTRIES) {
          moduleMemoryCache.set(key, { value: text, cachedAt: Date.now() });
        }
        tracer?.addSpan(`storage:${sk}`, Math.round(performance.now() - start), "cache");
        return { data: JSON.parse(text) as T, source: "cache" };
      }
    }

    // Tier 3: R2
    if (!this.env.AQUIFER_CONTENT) {
      tracer?.addSpan(`storage:${sk}`, Math.round(performance.now() - start), "miss");
      return { data: null, source: "miss" };
    }
    const obj = await this.env.AQUIFER_CONTENT.get(key);
    if (!obj) {
      tracer?.addSpan(`storage:${sk}`, Math.round(performance.now() - start), "miss");
      return { data: null, source: "miss" };
    }

    const text = await obj.text();
    if (moduleMemoryCache.size < MAX_MEMORY_ENTRIES) {
      moduleMemoryCache.set(key, { value: text, cachedAt: Date.now() });
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

    tracer?.addSpan(`storage:${sk}`, Math.round(performance.now() - start), "r2");
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

export function articleIndexKey(resourceCode: string, sha: string): string {
  return `index/${resourceCode}/${sha}/articles.json`;
}
