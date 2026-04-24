import type {
  Env,
  ResourceEntry,
  ArticleRef,
  ResourceMetadata,
  NavigabilityIndex,
} from "./types.js";
import { metadataUrl, fetchJson, fetchRepoSha, fetchOrgRepos } from "./github.js";
import { isValidIndexReference, rangesOverlap } from "./references.js";
import { AquiferStorage, indexKey, metadataKey, passageIndexKey, titleIndexKey, articleIndexKey, entityIndexKey, contentKey } from "./storage.js";

/** Per-resource article lookup: content_id → file location + minimal metadata. */
export interface ArticleLookupEntry {
  file: string;
  ref: string;
  title: string;
}
import type { RequestTracer } from "./tracing.js";

/** Well-known R2 key for the current index — eliminates KV pointer read from hot path. */
const CURRENT_INDEX_KEY = "index/current/navigability.json";
const SHA_STALE_MS = 15 * 60 * 1000; // 15 minutes
const INDEX_MEMORY_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Concurrency caps for entity index population during buildIndex. Scanning all
 * content files for ACAI entity references would otherwise blow the Worker
 * memory budget — the same OOM mechanism (J-002 / J-003) that affected the
 * old user-blocking bootstrap path. The same caps apply here for the same
 * reason; this code runs at index-build time instead of per-query, which
 * removes the user-visible latency but does not change the per-fetch memory
 * cost.
 */
const ENTITY_BUILD_RESOURCE_CONCURRENCY = 4;
const ENTITY_BUILD_FILE_CONCURRENCY = 8;

/**
 * Run `fn` over `items` in batches of `chunkSize`, awaiting each batch to
 * settle before starting the next. Same shape as Promise.allSettled but with
 * memory usage bounded by the chunk size rather than the total item count.
 *
 * Duplicated from tools.ts intentionally: registry.ts cannot import from
 * tools.ts (tools.ts depends on registry.ts), and the helper is small enough
 * that a single canonical source isn't worth the dependency-graph contortion.
 * See odd/ledger/journal.md J-005 for H12 — both call sites should eventually
 * collapse onto a shared helper module if this duplication ever grows.
 */
async function settledInChunks<T, R>(
  items: readonly T[],
  chunkSize: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  if (chunkSize <= 0) throw new Error("settledInChunks: chunkSize must be > 0");
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const batch = items.slice(i, i + chunkSize);
    const settled = await Promise.allSettled(batch.map((item, j) => fn(item, i + j)));
    for (const r of settled) results.push(r);
  }
  return results;
}

/** Module-level memory cache — survives across requests within the same isolate. */
let cachedIndex: NavigabilityIndex | null = null;
let indexFetchedAt = 0;

export async function getOrBuildIndex(env: Env, storage: AquiferStorage, ctx?: ExecutionContext, tracer?: RequestTracer): Promise<NavigabilityIndex> {
  // --- Tier 1: Module-level memory cache (0 subrequests) ---
  if (cachedIndex && Date.now() - indexFetchedAt < INDEX_MEMORY_TTL_MS) {
    tracer?.addSpan("index", 0, "memory");
    return cachedIndex;
  }

  // --- Tier 2: Well-known R2 key via Cache API (1 subrequest max) ---
  const { data } = await storage.getJSON<SerializedIndex>(CURRENT_INDEX_KEY, tracer);
  if (data?.registry) {
    const index = deserializeIndex(data);
    cachedIndex = index;
    indexFetchedAt = Date.now();

    // Background refresh if SHAs are stale
    if (ctx && (!data.checked_at || Date.now() - data.checked_at > SHA_STALE_MS)) {
      ctx.waitUntil(refreshAndUpdateCurrentIndex(env, storage));
    }

    return index;
  }

  // --- Tier 3: Cold build (no cached index exists) ---
  tracer?.addSpan("cold-path", 0, undefined, "no cached index, rebuilding");

  const orgStart = performance.now();
  const repoCodes = await fetchOrgRepos(env.AQUIFER_ORG, env);
  tracer?.addSpan("org-repos", Math.round(performance.now() - orgStart), "kv", `${repoCodes.length} repos`);

  const shaStart = performance.now();
  const repoShas = await fetchAllRepoShas(repoCodes, env);
  tracer?.addSpan("repo-shas", Math.round(performance.now() - shaStart), "github", `${repoShas.size} resolved`);

  const compositeHash = await computeCompositeHash(repoShas);
  const shaKey = indexKey(compositeHash);

  // Check R2 for this composite (well-known key was missing but SHA-keyed index may exist)
  const { data: existing } = await storage.getJSON<SerializedIndex>(shaKey, tracer);
  if (existing?.registry) {
    existing.checked_at = Date.now();
    await Promise.all([
      storage.putJSON(shaKey, existing),
      storage.putJSON(CURRENT_INDEX_KEY, existing),
    ]);
    const index = deserializeIndex(existing);
    cachedIndex = index;
    indexFetchedAt = Date.now();
    return index;
  }

  const buildStart = performance.now();
  const index = await buildIndex(repoCodes, env, storage, repoShas);
  tracer?.addSpan("index-build", Math.round(performance.now() - buildStart), undefined, `${index.registry.length} resources`);
  index.composite_sha = compositeHash;
  index.repo_shas = repoShas;

  // Store in R2: SHA-keyed (immutable) + well-known current (mutable)
  const serialized = serializeForStorage(index);
  serialized.checked_at = Date.now();
  const writeStart = performance.now();
  const written = await storage.putJSON(shaKey, serialized);
  tracer?.addSpan("r2-write", Math.round(performance.now() - writeStart), "r2");
  if (written) {
    await storage.putJSON(CURRENT_INDEX_KEY, serialized);
  }

  cachedIndex = index;
  indexFetchedAt = Date.now();
  return index;
}

async function refreshAndUpdateCurrentIndex(env: Env, storage: AquiferStorage): Promise<void> {
  try {
    const repoCodes = await fetchOrgRepos(env.AQUIFER_ORG, env);
    const repoShas = await fetchAllRepoShas(repoCodes, env);
    const compositeHash = await computeCompositeHash(repoShas);

    // Read current to check if SHA changed
    const { data: current } = await storage.getJSON<SerializedIndex>(CURRENT_INDEX_KEY);
    if (current?.composite_sha === compositeHash) {
      // No change — update checked_at only
      current.checked_at = Date.now();
      await storage.putJSON(CURRENT_INDEX_KEY, current);
      return;
    }

    // SHA changed — check if index already exists in R2
    const shaKey = indexKey(compositeHash);
    const { data: existing } = await storage.getJSON<SerializedIndex>(shaKey);
    if (existing?.registry) {
      existing.checked_at = Date.now();
      await Promise.all([
        storage.putJSON(shaKey, existing),
        storage.putJSON(CURRENT_INDEX_KEY, existing),
      ]);
      // Update module-level cache
      cachedIndex = deserializeIndex(existing);
      indexFetchedAt = Date.now();
      return;
    }

    // Build fresh index in background
    const index = await buildIndex(repoCodes, env, storage, repoShas);
    index.composite_sha = compositeHash;
    index.repo_shas = repoShas;

    const serialized = serializeForStorage(index);
    serialized.checked_at = Date.now();
    const written = await storage.putJSON(shaKey, serialized);
    if (written) {
      await storage.putJSON(CURRENT_INDEX_KEY, serialized);
      // Update module-level cache
      cachedIndex = index;
      indexFetchedAt = Date.now();
    }
  } catch {
    // Background refresh failed — current index remains valid (truthful degradation)
  }
}

async function fetchAllRepoShas(repoCodes: string[], env: Env): Promise<Map<string, string>> {
  const results = await Promise.allSettled(
    repoCodes.map(async (code) => {
      const sha = await fetchRepoSha(env.AQUIFER_ORG, code, env);
      return { code, sha };
    }),
  );
  const map = new Map<string, string>();
  const rejected: string[] = [];
  for (const [i, r] of results.entries()) {
    if (r.status === "fulfilled") {
      map.set(r.value.code, r.value.sha);
    } else {
      rejected.push(`${repoCodes[i]}: ${r.reason?.message ?? "unknown"}`);
    }
  }
  if (rejected.length > 0) {
    console.error(
      `fetchAllRepoShas: ${rejected.length}/${repoCodes.length} repos failed SHA fetch — these will be EXCLUDED from index:`,
      rejected,
    );
  }
  return map;
}

async function computeCompositeHash(repoShas: Map<string, string>): Promise<string> {
  const parts = [...repoShas.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, sha]) => `${code}:${sha}`)
    .join(",");
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts));
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

async function buildIndex(
  repoCodes: string[],
  env: Env,
  storage: AquiferStorage,
  repoShas: Map<string, string>,
): Promise<NavigabilityIndex> {
  const registry: ResourceEntry[] = [];

  const results = await Promise.allSettled(
    repoCodes.map(async (code) => {
      const repoSha = repoShas.get(code);
      if (!repoSha) return null;
      const url = metadataUrl(env.AQUIFER_ORG, code, "eng");
      const key = metadataKey(code, repoSha, "eng");
      const metadata = await fetchJson<ResourceMetadata>(url, storage, key);
      if (!metadata?.resource_metadata) return null;
      return { code, metadata };
    }),
  );

  const writePromises: Promise<unknown>[] = [];

  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const { code, metadata } = result.value;
    const rm = metadata.resource_metadata;

    // Compute article count — Bible resources may lack article_metadata
    let articleCount = Object.keys(metadata.article_metadata ?? {}).length;
    if (articleCount === 0 && (rm.order === "canonical" || rm.aquifer_type.toLowerCase() === "bible")) {
      const ingredients = Object.keys(metadata.scripture_burrito?.ingredients ?? {});
      const contentFiles = ingredients.filter(k => k.startsWith("json/") && k.endsWith(".content.json"));
      if (contentFiles.length > 0) {
        articleCount = contentFiles.length;
      }
    }

    registry.push({
      resource_code: code,
      aquifer_type: rm.aquifer_type,
      resource_type: rm.resource_type,
      title: rm.title,
      short_name: rm.short_name ?? code,
      order: rm.order ?? "canonical",
      language: rm.language,
      localizations: rm.localizations ?? [],
      article_count: articleCount,
      version: rm.version,
    });

    if (!metadata.article_metadata) continue;

    const resourcePassage = new Map<string, ArticleRef[]>();
    const resourceTitles: ArticleRef[] = [];
    const articleLookup: Record<string, ArticleLookupEntry> = {};

    for (const [contentId, article] of Object.entries(metadata.article_metadata)) {
      const fallbackTitle = article.index_reference && !isValidIndexReference(article.index_reference)
        ? article.index_reference
        : `Article ${contentId}`;
      const englishTitle = article.localizations?.eng?.title ?? article.title ?? fallbackTitle;
      const ref = article.index_reference ?? "";
      const baseRef: ArticleRef = {
        resource_code: code,
        language: rm.language,
        content_id: contentId,
        title: englishTitle,
        resource_type: rm.resource_type,
        index_reference: article.index_reference,
      };

      resourceTitles.push(baseRef);

      if (article.index_reference && isValidIndexReference(article.index_reference)) {
        const existing = resourcePassage.get(article.index_reference);
        if (existing) {
          existing.push(baseRef);
        } else {
          resourcePassage.set(article.index_reference, [baseRef]);
        }
      }

      // Article lookup: derive file from index_reference for canonical, empty for non-canonical
      let file = "";
      if (rm.order === "canonical" && ref.length >= 2 && /^\d{2}/.test(ref)) {
        file = `${ref.slice(0, 2)}.content.json`;
      }
      articleLookup[contentId] = { file, ref, title: englishTitle };
    }

    const repoSha = repoShas.get(code)!;

    // For non-canonical resources, assign files using scripture_burrito ingredients
    if (rm.order !== "canonical") {
      const ingredientKeys = Object.keys(metadata.scripture_burrito?.ingredients ?? {});
      const contentFiles = ingredientKeys
        .filter(k => k.startsWith("json/") && k.endsWith(".content.json"))
        .map(k => k.replace(/^json\//, ""))
        .sort();

      if (contentFiles.length > 0) {
        // Distribute articles across files in order (articles are grouped by file)
        // For each article, assign the file based on article ordering or fallback to first file
        const unassigned = Object.entries(articleLookup).filter(([, v]) => !v.file);
        if (unassigned.length > 0 && contentFiles.length === 1) {
          // Single file — all articles go there
          for (const [, entry] of unassigned) entry.file = contentFiles[0]!;
        }
        // For multi-file non-canonical: leave file empty (resolved at query time via KV hint or scan)
        // The article index still provides ref + title for browse/search without file scanning
      }
    }

    // Collect per-resource index writes to parallelize across all resources
    if (resourcePassage.size > 0) {
      writePromises.push(storage.putJSON(passageIndexKey(code, repoSha), Array.from(resourcePassage.entries())));
    }
    if (resourceTitles.length > 0) {
      writePromises.push(storage.putJSON(titleIndexKey(code, repoSha), resourceTitles));
    }
    if (Object.keys(articleLookup).length > 0) {
      writePromises.push(storage.putJSON(articleIndexKey(code, repoSha), articleLookup));
    }
  }

  // Write all per-resource indexes (passage/title/article) to R2 in parallel
  await Promise.allSettled(writePromises);

  // H11b: entity-index population is NOT done here anymore. The inline scan
  // here (H11) added ~22s to cold index builds, which is still user-blocking
  // on true cold-starts. Instead, entity indexes are lazily populated per
  // resource when fanOutEntitySearch encounters a missing per-resource index
  // at query time: the missing resource's scan is triggered via
  // ctx.waitUntil(), the caller receives a partial-with-transparency
  // response now, and the next visit finds the warmed index.
  //
  // This implements the principle: "partial data with transparency to come
  // back for more; background fetch warms the cache before you come back."
  // The user never blocks on a corpus scan — not at index-build time, not at
  // query time. populateEntityIndexes stays as the scan implementation
  // invoked from the background path; see warmEntityIndexesForResources.

  // Return lightweight index — passage/title/entity are empty.
  // Queries use fan-out functions to load per-resource indexes on demand.
  return {
    registry,
    passage: new Map(),
    entity: new Map(),
    title: [],
    built_at: Date.now(),
    composite_sha: "",
    repo_shas: repoShas,
  };
}

/**
 * H11: Build per-resource entity indexes by scanning content files. For each
 * resource, walks every JSON content file in scripture_burrito.ingredients,
 * collects every (entity_id → ArticleRef[]) mapping found in
 * `article.associations.acai`, and writes the resulting Map to R2 keyed by
 * entityIndexKey(code, sha). Memory is bounded by ENTITY_BUILD_RESOURCE_*
 * and ENTITY_BUILD_FILE_CONCURRENCY caps using settledInChunks, mirroring
 * the pre-H11 bootstrap path's safety profile.
 *
 * Failure handling: per-file failures are swallowed (the file's entities
 * just don't appear in the index for this build). Per-resource failures
 * mean the resource has no entityIndexKey written; fanOutEntitySearch will
 * see a miss for that resource on the next query, which is the correct
 * truthful-degradation behavior. The next index rebuild gets another shot.
 *
 * Performance: this adds a one-time cost to cold index builds. The pre-H11
 * bootstrap was paying this cost per-entity-lookup; H11 pays it once and
 * memoizes for the life of the composite SHA. Background refresh
 * (refreshAndUpdateCurrentIndex via ctx.waitUntil) absorbs the cost away
 * from user-visible latency for non-first cold builds.
 */
async function populateEntityIndexes(
  results: PromiseSettledResult<{ code: string; metadata: ResourceMetadata } | null>[],
  env: Env,
  storage: AquiferStorage,
  repoShas: Map<string, string>,
): Promise<void> {
  const resources: Array<{ code: string; language: string; files: string[]; sha: string }> = [];
  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const { code, metadata } = result.value;
    const sha = repoShas.get(code);
    if (!sha) continue;
    const ingredients = Object.keys(metadata.scripture_burrito?.ingredients ?? {});
    const files = ingredients
      .filter((k) => k.startsWith("json/") && k.endsWith(".content.json"))
      .map((k) => k.replace(/^json\//, ""))
      .sort();
    if (files.length === 0) continue;
    resources.push({ code, language: metadata.resource_metadata.language, files, sha });
  }

  await settledInChunks(resources, ENTITY_BUILD_RESOURCE_CONCURRENCY, async ({ code, language, files, sha }) => {
    const entityMap = new Map<string, ArticleRef[]>();

    await settledInChunks(files, ENTITY_BUILD_FILE_CONCURRENCY, async (file) => {
      const url = `https://raw.githubusercontent.com/${env.AQUIFER_ORG}/${code}/${sha}/${language}/json/${file}`;
      const key = contentKey(code, sha, language, file);
      let articles: import("./types.js").ArticleContent[] | null = null;
      try {
        articles = await fetchJson<import("./types.js").ArticleContent[]>(url, storage, key);
      } catch {
        return; // per-file failure — swallow, see comment above
      }
      if (!articles?.length) return;
      for (const article of articles) {
        const acaiAssociations = article.associations?.acai ?? [];
        for (const a of acaiAssociations) {
          const entityId = String(a.id || "").toLowerCase();
          if (!entityId) continue;
          const ref: ArticleRef = {
            resource_code: code,
            language: article.language || language,
            content_id: String(article.content_id),
            title: article.title || `Article ${article.content_id}`,
            resource_type: "",
            index_reference: article.index_reference,
          };
          const existing = entityMap.get(entityId);
          if (existing) {
            existing.push(ref);
          } else {
            entityMap.set(entityId, [ref]);
          }
        }
      }
    });

    if (entityMap.size > 0) {
      // Serialize Map → array of [entityId, ArticleRef[]] entries for JSON.
      await storage.putJSON(entityIndexKey(code, sha), Array.from(entityMap.entries()));
    }
  });
}

/**
 * Result of a fanOutEntitySearch. Carries `matches` (the union of ArticleRefs
 * found across per-resource entity indexes), a `missing_resources` list of
 * registry entries that had no entity index populated at query time (these
 * are the resources the caller should kick off a background warm for), and
 * `scanned_resources`/`total_resources` for disclosure text.
 *
 * `complete` is true iff every registry resource either returned a
 * populated per-resource entity index OR had no repoSha (structurally
 * unscannable — absence is not incompleteness). False means at least one
 * resource is still un-indexed and a warm should be triggered.
 */
export interface FanOutEntityResult {
  matches: ArticleRef[];
  complete: boolean;
  scanned_resources: number;
  total_resources: number;
  missing_resources: ResourceEntry[];
}

/**
 * H11b: load all per-resource entity indexes in parallel and union-merge any
 * matches for the requested entityId. The returned FanOutEntityResult tells
 * the caller which per-resource indexes were missing; callers should kick
 * off a background warm for those (via ctx.waitUntil +
 * warmEntityIndexesForResources) and surface the partial result to the user
 * with transparent disclosure.
 *
 * This is the hot path — it MUST remain fast. It does N parallel R2 reads
 * of small per-resource entity blobs (typically <100KB each) and nothing
 * else. The corpus scan that builds those blobs lives in the warm path.
 */
export async function fanOutEntitySearch(
  entityId: string,
  index: NavigabilityIndex,
  storage: AquiferStorage,
  tracer?: RequestTracer,
): Promise<FanOutEntityResult> {
  const normalized = entityId.toLowerCase();

  // In-memory short-circuit (tests pre-seed this; also serves production
  // callers within the same isolate when an entity has been warmed recently).
  const memHit = index.entity.get(normalized);
  if (memHit?.length) {
    return {
      matches: memHit,
      complete: true,
      scanned_resources: index.registry.length,
      total_resources: index.registry.length,
      missing_resources: [],
    };
  }

  const fanStart = performance.now();
  let hits = 0;
  let misses = 0;
  const missingResources: ResourceEntry[] = [];

  const results = await Promise.allSettled(
    index.registry.map(async (entry) => {
      const sha = index.repo_shas.get(entry.resource_code);
      if (!sha) {
        // Structurally unscannable — absence of a repoSha means this resource
        // has no content to scan, so it counts as "scanned" for completeness
        // purposes (the warm path would write an empty index for it).
        return { refs: [] as ArticleRef[], hit: true };
      }
      const key = entityIndexKey(entry.resource_code, sha);
      const { data } = await storage.getJSON<Array<[string, ArticleRef[]]>>(key, tracer);
      if (!data) {
        missingResources.push(entry);
        misses++;
        return { refs: [], hit: false };
      }
      hits++;
      for (const [eid, refs] of data) {
        if (eid === normalized) {
          return {
            refs: refs.map((r) => ({ ...r, resource_type: entry.resource_type })),
            hit: true,
          };
        }
      }
      // Index present but no match for this entity in this resource.
      return { refs: [], hit: true };
    }),
  );

  tracer?.addSpan("fanout-entities", Math.round(performance.now() - fanStart), undefined,
    `${index.registry.length} resources, ${hits} hits, ${misses} missing`);

  const matches: ArticleRef[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") matches.push(...r.value.refs);
  }

  return {
    matches,
    complete: missingResources.length === 0,
    scanned_resources: index.registry.length - missingResources.length,
    total_resources: index.registry.length,
    missing_resources: missingResources,
  };
}

/**
 * H11b: background warm — scan the content files for ONLY the specified
 * resources and write their per-resource entity indexes to R2. Called from
 * ctx.waitUntil() after a partial fanOutEntitySearch, so the user's response
 * has already been returned before this runs.
 *
 * Memory profile is identical to populateEntityIndexes: same
 * ENTITY_BUILD_RESOURCE_CONCURRENCY × ENTITY_BUILD_FILE_CONCURRENCY caps.
 * Failures are swallowed per-file and per-resource — a failed warm just
 * means the next query re-triggers the same warm (self-healing).
 *
 * This function re-fetches each resource's metadata to enumerate its
 * content files. That's an extra metadata fetch per call, but the
 * metadata fetch is already cached at the storage layer (R2 KV), so the
 * cost is bounded.
 */
export async function warmEntityIndexesForResources(
  resources: readonly ResourceEntry[],
  repoShas: Map<string, string>,
  env: Env,
  storage: AquiferStorage,
): Promise<void> {
  const scanTargets: Array<{ code: string; language: string; files: string[]; sha: string }> = [];

  for (const entry of resources) {
    const sha = repoShas.get(entry.resource_code);
    if (!sha) continue;
    const url = metadataUrl(env.AQUIFER_ORG, entry.resource_code, "eng");
    const key = metadataKey(entry.resource_code, sha, "eng");
    let metadata: ResourceMetadata | null = null;
    try {
      metadata = await fetchJson<ResourceMetadata>(url, storage, key);
    } catch {
      continue; // per-resource metadata fetch failure — skip; next warm retries
    }
    if (!metadata?.scripture_burrito?.ingredients) continue;
    const ingredients = Object.keys(metadata.scripture_burrito.ingredients);
    const files = ingredients
      .filter((k) => k.startsWith("json/") && k.endsWith(".content.json"))
      .map((k) => k.replace(/^json\//, ""))
      .sort();
    if (files.length === 0) continue;
    scanTargets.push({ code: entry.resource_code, language: entry.language, files, sha });
  }

  await settledInChunks(scanTargets, ENTITY_BUILD_RESOURCE_CONCURRENCY, async ({ code, language, files, sha }) => {
    // Before doing the work, check if another concurrent warm already wrote
    // this resource's index — idempotency cheap guard against duplicate work.
    const key = entityIndexKey(code, sha);
    const { data: existing } = await storage.getJSON<Array<[string, ArticleRef[]]>>(key);
    if (existing) return;

    const entityMap = new Map<string, ArticleRef[]>();

    await settledInChunks(files, ENTITY_BUILD_FILE_CONCURRENCY, async (file) => {
      const url = `https://raw.githubusercontent.com/${env.AQUIFER_ORG}/${code}/${sha}/${language}/json/${file}`;
      const contentK = contentKey(code, sha, language, file);
      let articles: import("./types.js").ArticleContent[] | null = null;
      try {
        articles = await fetchJson<import("./types.js").ArticleContent[]>(url, storage, contentK);
      } catch {
        return; // per-file failure — swallowed; self-healing on next warm
      }
      if (!articles?.length) return;
      for (const article of articles) {
        const acaiAssociations = article.associations?.acai ?? [];
        for (const a of acaiAssociations) {
          const entityId = String(a.id || "").toLowerCase();
          if (!entityId) continue;
          const ref: ArticleRef = {
            resource_code: code,
            language: article.language || language,
            content_id: String(article.content_id),
            title: article.title || `Article ${article.content_id}`,
            resource_type: "",
            index_reference: article.index_reference,
          };
          const existing = entityMap.get(entityId);
          if (existing) existing.push(ref);
          else entityMap.set(entityId, [ref]);
        }
      }
    });

    // Always write — even an empty map is a valid signal: "this resource has
    // no ACAI associations." Without this, fanOutEntitySearch would keep
    // scheduling warms forever for resources that genuinely have no entities.
    await storage.putJSON(key, Array.from(entityMap.entries()));
  });
}

// --- Fan-out query functions ---

/**
 * Search passages across all resources by loading per-resource passage indexes in parallel.
 * Falls back to in-memory index.passage if populated (e.g. in tests).
 */
export async function fanOutPassageSearch(
  ref: string,
  index: NavigabilityIndex,
  storage: AquiferStorage,
  tracer?: RequestTracer,
): Promise<ArticleRef[]> {
  // If passage data is already in memory (tests provide this), use it directly
  if (index.passage.size > 0) {
    const matches: ArticleRef[] = [];
    for (const [range, refs] of index.passage) {
      if (rangesOverlap(ref, range)) matches.push(...refs);
    }
    return matches;
  }

  // Fan out: load per-resource passage indexes in parallel
  const fanStart = performance.now();
  let hits = 0;
  let misses = 0;

  const results = await Promise.allSettled(
    index.registry.map(async (entry) => {
      const sha = index.repo_shas.get(entry.resource_code);
      if (!sha) { misses++; return []; }
      const key = passageIndexKey(entry.resource_code, sha);
      const { data } = await storage.getJSON<Array<[string, ArticleRef[]]>>(key, tracer);
      if (!data) { misses++; return []; }
      hits++;
      const matches: ArticleRef[] = [];
      for (const [range, refs] of data) {
        if (rangesOverlap(ref, range)) matches.push(...refs);
      }
      return matches;
    }),
  );

  tracer?.addSpan("fanout-passages", Math.round(performance.now() - fanStart), undefined,
    `${index.registry.length} resources, ${hits} hits, ${misses} misses`);

  const matches: ArticleRef[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") matches.push(...r.value);
  }
  return matches;
}

/**
 * Search titles across all resources by loading per-resource title indexes in parallel.
 * Falls back to in-memory index.title if populated (e.g. in tests).
 */
export async function fanOutTitleSearch(
  terms: string[],
  index: NavigabilityIndex,
  storage: AquiferStorage,
  tracer?: RequestTracer,
): Promise<ArticleRef[]> {
  // If title data is already in memory (tests provide this), use it directly
  if (index.title.length > 0) {
    const matches: ArticleRef[] = [];
    for (const ref of index.title) {
      const title = ref.title.toLowerCase();
      if (terms.every((t) => title.includes(t))) matches.push(ref);
    }
    return matches;
  }

  // Fan out: load per-resource title indexes in parallel
  const fanStart = performance.now();
  let hits = 0;
  let misses = 0;

  const results = await Promise.allSettled(
    index.registry.map(async (entry) => {
      const sha = index.repo_shas.get(entry.resource_code);
      if (!sha) { misses++; return []; }
      const key = titleIndexKey(entry.resource_code, sha);
      const { data } = await storage.getJSON<ArticleRef[]>(key, tracer);
      if (!data) { misses++; return []; }
      hits++;
      return data.filter((ref) => {
        const title = ref.title.toLowerCase();
        return terms.every((t) => title.includes(t));
      });
    }),
  );

  tracer?.addSpan("fanout-titles", Math.round(performance.now() - fanStart), undefined,
    `${index.registry.length} resources, ${hits} hits, ${misses} misses`);

  const matches: ArticleRef[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") matches.push(...r.value);
  }
  return matches;
}

/**
 * Load the article lookup index for a single resource.
 * Returns a map of content_id → { file, ref, title }.
 */
export async function loadArticleLookup(
  resourceCode: string,
  sha: string,
  storage: AquiferStorage,
  tracer?: RequestTracer,
): Promise<Record<string, ArticleLookupEntry> | null> {
  const key = articleIndexKey(resourceCode, sha);
  const { data } = await storage.getJSON<Record<string, ArticleLookupEntry>>(key, tracer);
  return data;
}

// --- Serialization ---

interface SerializedIndex {
  registry: ResourceEntry[];
  passage: Array<[string, ArticleRef[]]>;
  entity: Array<[string, ArticleRef[]]>;
  title: ArticleRef[];
  built_at: number;
  composite_sha: string;
  repo_shas: Array<[string, string]>;
  checked_at: number; // when SHAs were last verified against GitHub
}

function serializeForStorage(index: NavigabilityIndex): SerializedIndex {
  return {
    registry: index.registry,
    passage: [], // Per-resource indexes stored separately in R2
    entity: [], // Entity data bootstrapped on demand
    title: [], // Per-resource indexes stored separately in R2
    built_at: index.built_at,
    composite_sha: index.composite_sha,
    repo_shas: Array.from(index.repo_shas.entries()),
    checked_at: 0,
  };
}

function deserializeIndex(data: SerializedIndex): NavigabilityIndex {
  return {
    registry: data.registry,
    passage: new Map(data.passage),
    entity: new Map(data.entity),
    title: data.title ?? [],
    built_at: data.built_at,
    composite_sha: data.composite_sha ?? "",
    repo_shas: new Map(data.repo_shas ?? []),
  };
}
